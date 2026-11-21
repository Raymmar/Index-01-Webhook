import { useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Platform, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { c, s } from './ui';

/** Release-only actions: crossing the threshold and returning cancels the action. */
export function SwipeTaskRow({ children, disabled, onPin, onDelete, id, allowPendingPin = false, pinEnabled = true }: {
  children: (guard: (action: () => void) => void) => ReactNode;
  disabled: boolean; onPin: () => void; onDelete: () => void; id: string;
  allowPendingPin?: boolean; pinEnabled?: boolean;
}) {
  const offset = useRef(new Animated.Value(0)).current;
  const [side, setSide] = useState<'pin' | 'delete'>('delete');
  function reset() {
    Animated.spring(offset, { toValue: 0, stiffness: 340, damping: 34, mass: 1, useNativeDriver: true }).start();
  }
  const latest = useRef({ disabled, onPin, onDelete, allowPendingPin, pinEnabled });
  latest.current = { disabled, onPin, onDelete, allowPendingPin, pinEnabled };
  const gesture = useRef({ x: 0, y: 0, dx: 0, dy: 0, active: false, blocked: false, horizontal: false });
  const suppressUntil = useRef(0);
  function move(dx: number, dy: number) {
    const g = gesture.current;
    if (!g.active || g.blocked || (latest.current.disabled && !latest.current.allowPendingPin)) return;
    g.dx = dx; g.dy = dy;
    if ((dx > 0 && !latest.current.pinEnabled) || (dx < 0 && latest.current.disabled)) { offset.setValue(0); return; }
    if (!g.horizontal && Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) g.blocked = true;
    if (!g.blocked && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      g.horizontal = true;
      suppressUntil.current = Date.now() + 500;
      setSide(dx > 0 ? 'pin' : 'delete');
      // Follow the finger directly, then add resistance instead of a hard cap.
      const distance = Math.abs(dx);
      offset.setValue(Math.sign(dx) * (distance <= 96 ? distance : 96 + (distance - 96) * 0.3));
    }
  }
  function finish(cancel = false) {
    const g = gesture.current;
    if (!g.active) return;
    g.active = false;
    reset();
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
    if (t.touches.length !== 1) { gesture.current.blocked = true; reset(); return; }
    move(t.touches[0].pageX - gesture.current.x, t.touches[0].pageY - gesture.current.y);
  }
  return <View testID={`swipe-task-${id}`} {...responder.panHandlers}
    onTouchStart={e => {
      offset.stopAnimation();
      offset.setValue(0);
      const t = e.nativeEvent;
      gesture.current = { x: t.touches[0]?.pageX ?? 0, y: t.touches[0]?.pageY ?? 0, dx: 0, dy: 0, active: true, blocked: t.touches.length !== 1, horizontal: false };
    }}
    onTouchMove={touchMove} onTouchEnd={() => finish()} onTouchCancel={() => finish(true)}
    style={[{ overflow: 'hidden' }, Platform.OS === 'web' && ({ touchAction: 'pan-y' } as ViewStyle)]}>
    <Animated.View testID={`swipe-action-${id}`} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: side === 'pin' ? 'flex-start' : 'flex-end', paddingHorizontal: 20, backgroundColor: side === 'pin' ? c.pin : c.destructive, opacity: offset.interpolate({ inputRange: [-20, 0, 20], outputRange: [1, 0, 1], extrapolate: 'clamp' }) }}>
      <View style={{ alignItems: 'center', gap: 5 }}>
        <Feather name={side === 'pin' ? 'map-pin' : 'trash-2'} size={22} color={side === 'pin' ? c.pinForeground : c.destructiveForeground} />
        <Text style={[s.muted, { fontSize: 12, color: side === 'pin' ? c.pinForeground : c.destructiveForeground }]}>{side === 'pin' ? 'Pin' : 'Delete'}</Text>
      </View>
    </Animated.View>
    <Animated.View style={{ backgroundColor: c.card, transform: [{ translateX: offset }], opacity: disabled ? 0.55 : 1 }}>
      {children(action => { if (!latest.current.disabled && Date.now() >= suppressUntil.current) action(); })}
    </Animated.View>
  </View>;
}
