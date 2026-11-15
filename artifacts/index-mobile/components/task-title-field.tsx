import { useLayoutEffect, useRef, useState, type ElementRef } from 'react';
import { Platform, type TextInput, type TextInputProps } from 'react-native';
import { Field } from './ui';

// Only task text grows; dates and the other shared Fields stay single-line.
export function TaskTitleField(props: TextInputProps) {
  const ref = useRef<ElementRef<typeof TextInput>>(null);
  const [height, setHeight] = useState(105);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    // React Native Web forwards TextInput's ref to the underlying textarea.
    const node = ref.current as unknown as HTMLTextAreaElement | null;
    if (!node) return;
    const resize = () => {
      const style = getComputedStyle(node);
      // Measure an unfocused copy: resetting a focused textarea's height can
      // distort scrollHeight around its caret and move the containing sheet.
      const measure = node.cloneNode() as HTMLTextAreaElement;
      measure.removeAttribute('id');
      measure.removeAttribute('data-testid');
      measure.setAttribute('aria-hidden', 'true');
      measure.tabIndex = -1;
      Object.assign(measure.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', height: '0px', minHeight: '0px', maxHeight: 'none', width: `${node.getBoundingClientRect().width}px` });
      measure.value = node.value || node.placeholder || ' ';
      node.parentElement!.appendChild(measure);
      const measured = measure.scrollHeight;
      measure.remove();
      node.style.height = `${Math.max(105, Math.ceil(measured + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)))}px`;
    };
    resize();
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(node);
    let active = true;
    void document.fonts.ready.then(() => { if (active) resize(); });
    document.fonts.addEventListener('loadingdone', resize);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', resize); };
  }, [props.value]);
  return <Field {...props} ref={ref} multiline scrollEnabled={false} submitBehavior="newline"
    onContentSizeChange={event => {
      // Native reports content (including padding), but not the two border pixels.
      if (Platform.OS !== 'web') setHeight(Math.max(105, Math.ceil(event.nativeEvent.contentSize.height) + 2));
      props.onContentSizeChange?.(event);
    }}
    style={[{ minHeight: 105, textAlignVertical: 'top', lineHeight: 26, ...(Platform.OS === 'web' ? { overflow: 'hidden' as const } : { height }) }, props.style]} />;
}
