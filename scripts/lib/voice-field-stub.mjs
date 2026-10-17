// A stand-in for app/voice-field.tsx in render tests that walk a form's element tree by hand. The real field runs hooks and renders its own
// input, which a hand-driven harness that only calls the form's own function never reaches. This stub is a component without hooks that
// renders the markup the real field renders (the label, the input or text area, the microphone button) from the same props, so
// renderToStaticMarkup shows it, and `expandVoiceFields` lets a hand-written tree walker see inside it, so a test finds and drives the field
// as it would a plain input: onChange takes the event, as the input's own does. What the field does (dictation) is native-speech.mjs.
import {jsx, jsxs} from 'react/jsx-runtime';

/** @param {(text: string) => string} translate the test's own t() */
export function makeVoiceField(translate = value => value) {
  function VoiceField({label, value, onChange, required = false, marked = false, multiline = false, full = false, disabled = false, rows = 3, className = '', inputRef, inputProps = {}}) {
    return jsxs('label', {
      className: ['field', 'voice-field', multiline || full ? 'full' : '', 'keyboard-input', className].filter(Boolean).join(' '),
      children: [
        jsxs('span', {children: [translate(label), (required || marked) && jsx('b', {children: ' *'})]}),
        jsxs('div', {children: [
          jsx(multiline ? 'textarea' : 'input', {...inputProps, ref: inputRef, ...(multiline ? {rows} : {}), required, disabled, value, onChange: event => onChange(event.target.value)}),
          jsx('button', {type: 'button', className: 'voice-button', disabled, 'aria-label': 'Dictate: ' + translate(label)})
        ]})
      ]
    });
  }
  VoiceField.voiceFieldStub = true;
  return VoiceField;
}
/** What a tree walker sees at a node: the stub's own markup in place of the stub, any other node as it is. The same node always expands to
 * the same object, so a test that finds a control through one walker can recognise it in another. */
const expanded = new WeakMap();
export const expandVoiceFields = node => {
  if (!node || typeof node !== 'object' || typeof node.type !== 'function' || !node.type.voiceFieldStub) return node;
  if (!expanded.has(node)) expanded.set(node, node.type(node.props));
  return expanded.get(node);
};
