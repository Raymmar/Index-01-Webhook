import { useRef } from 'react';
import { PanResponder } from 'react-native';

/** Claim deliberate horizontal swipes, but leave vertical scrolling and controls alone. */
export function useHorizontalSwipe(onSwipe: (direction: 'next' | 'previous') => void, enabled = true) {
  const latest = useRef({ onSwipe, enabled });
  latest.current = { onSwipe, enabled };
  const blocked = useRef(false);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      blocked.current = false;
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      latest.current.enabled && !blocked.current && gesture.numberActiveTouches === 1 &&
      Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
    onPanResponderRelease: (_, gesture) => {
      if (latest.current.enabled && !blocked.current && Math.abs(gesture.dx) >= 60 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6) {
        latest.current.onSwipe(gesture.dx < 0 ? 'next' : 'previous');
      }
    },
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => false,
  })).current;
  return { panHandlers: responder.panHandlers, blockSwipe: () => { blocked.current = true; } };
}
