import { useRef } from 'react';
import { PanResponder } from 'react-native';

/** Claim deliberate horizontal swipes, but leave vertical scrolling and controls alone. */
export function useHorizontalSwipe(onSwipe: (direction: 'next' | 'previous') => void, enabled = true) {
  const latest = useRef({ onSwipe, enabled });
  latest.current = { onSwipe, enabled };
  const blocked = useRef(false);
  const completed = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  function finish(dx: number, dy: number) {
    if (!latest.current.enabled || blocked.current || completed.current) return;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      completed.current = true;
      latest.current.onSwipe(dx < 0 ? 'next' : 'previous');
    }
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      blocked.current = false;
      completed.current = false;
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      latest.current.enabled && !blocked.current && gesture.numberActiveTouches === 1 &&
      Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderMove: (_, gesture) => finish(gesture.dx, gesture.dy),
    onPanResponderRelease: (_, gesture) => finish(gesture.dx, gesture.dy),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  })).current;
  return {
    panHandlers: {
      ...responder.panHandlers,
      // Native scroll views can own the responder before JS receives a move.
      // Observe actual finger movement as well, without consuming vertical drags.
      onTouchStart: (event: import('react-native').GestureResponderEvent) => {
        const touch = event.nativeEvent;
        completed.current = false;
        start.current = touch.touches.length === 1 ? { x: touch.pageX, y: touch.pageY } : null;
      },
      onTouchMove: (event: import('react-native').GestureResponderEvent) => {
        const touch = event.nativeEvent;
        if (start.current && touch.touches.length === 1) {
          finish(touch.pageX - start.current.x, touch.pageY - start.current.y);
        }
      },
      onTouchEnd: () => { start.current = null; },
      onTouchCancel: () => { start.current = null; },
    },
    blockSwipe: () => { blocked.current = true; },
  };
}
