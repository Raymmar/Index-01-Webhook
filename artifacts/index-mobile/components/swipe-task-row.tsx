import { useRef, useState, type ReactNode } from 'react';
import { PanResponder, Platform, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { c, s } from './ui';

/** Release-only actions: crossing the threshold and returning cancels the action. */
export function SwipeTaskRow({ children, disabled, onPin, onDelete, id, allowPendingPin = false, pinEnabled = true, leftLabel = 'Dismiss' }: {
  children: (guard: (action: () => void) => void) => ReactNode;
  disabled: boolean; onPin: () => void; onDelete: () => void; id: string;
  allowPendingPin?: boolean; pinEnabled?: boolean; leftLabel?: string;
}) {
  const [offset, setOffset] = useState(0);
  const latest = useRef({ disabled, onPin, onDelete, allowPendingPin, pinEnabled });
  latest.current = { disabled, onPin, onDelete, allowPendingPin, pinEnabled };
  const gesture = useRef({ x: 0, y: 0, dx: 0, dy: 0, active: false, blocked: false, horizontal: false });
  const suppressUntil = useRef(0);
  function move(dx: number, dy: number) {
    const g = gesture.current;
    if (!g.active || g.blocked || (latest.current.disabled && !latest.current.allowPendingPin)) return;
    g.dx = dx; g.dy = dy;
    if ((dx > 0 && !latest.current.pinEnabled) || (dx < 0 && latest.current.disabled)) { setOffset(0); return; }
    if (!g.horizontal && Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) g.blocked = true;
    if (!g.blocked && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      g.horizontal = true;
      suppressUntil.current = Date.now() + 500;
      setOffset(Math.max(-110, Math.min(110, dx)));
    }
  }
  function finish(cancel = false) {
    const g = gesture.current;
    if (!g.active) return;
    g.active = false;
    setOffset(0);
    if (g.horizontal) suppressUntil.current = Date.now() + 500;
    const allowed = g.dx > 0 ? latest.current.pinEnabled && (!latest.current.disabled || latest.current.allowPendingPin) : !latest.current.disabled;
    if (!cancel && !g.blocked && allowed && Math.abs(g.dx) >= 80 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5) {
      (g.dx > 0 ? latest.current.onPin : latest.current.onDelete)();
    }
  }
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => gesture.current.active && (!latest.current.disabled || (latest.current.allowPendingPin && g.dx > 0)) && (latest.current.pinEnabled || g.dx < 0) && !gesture.current.blocked && g.numberActiveTouches === 1 && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_, g) => move(g.moveX - gesture.current.x, g.moveY - gesture.current.y),
    onPanResponderRelease: () => finish(),
    onPanResponderTerminate: () => finish(true),
    onPanResponderTerminationRequest: () => true,
  })).current;
  function touchMove(e: GestureResponderEvent) {
    const t = e.nativeEvent;
    if (t.touches.length !== 1) { gesture.current.blocked = true; setOffset(0); return; }
    move(t.touches[0].pageX - gesture.current.x, t.touches[0].pageY - gesture.current.y);
  }
  return <View testID={`swipe-task-${id}`} {...responder.panHandlers}
    onTouchStart={e => {
      const t = e.nativeEvent;
      gesture.current = { x: t.touches[0]?.pageX ?? 0, y: t.touches[0]?.pageY ?? 0, dx: 0, dy: 0, active: true, blocked: t.touches.length !== 1, horizontal: false };
    }}
    onTouchMove={touchMove} onTouchEnd={() => finish()} onTouchCancel={() => finish(true)}
    style={[{ overflow: 'hidden' }, Platform.OS === 'web' && ({ touchAction: 'pan-y' } as ViewStyle)]}>
    {!!offset && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: offset > 0 ? 'flex-start' : 'flex-end', paddingHorizontal: 16, backgroundColor: c.secondary }}>
      <Text style={[s.muted, { color: offset > 0 ? c.accent : c.destructive }]}>{Math.abs(offset) >= 80 ? 'Release to ' : ''}{offset > 0 ? 'Pin' : leftLabel}</Text>
    </View>}
    <View style={{ backgroundColor: c.card, transform: [{ translateX: offset }], opacity: disabled ? 0.55 : 1 }}>
      {children(action => { if (!latest.current.disabled && Date.now() >= suppressUntil.current) action(); })}
    </View>
  </View>;
}
