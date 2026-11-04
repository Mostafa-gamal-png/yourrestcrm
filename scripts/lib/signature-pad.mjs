// The customer's signature pad in a real Chromium (2026-11-04), for the browser tests: drawn with pointer events as a mouse, a finger (real
// touch through the DevTools protocol, as the Android WebView and a phone send it; the context needs hasTouch) or a stylus (pen pointer
// events, a tablet's) does. Synthetic strokes only.

/** The pad of the signing step on the page. */
export const signaturePad = page => page.locator('.mold-signing .mold-signature-pad');

/** Draws on the pad: a wave across it, or 'dot' (a tap, which is no signature). input: mouse, touch or pen. */
export async function drawSignature(page, {input = 'mouse', shape = 'wave'} = {}) {
  const canvas = signaturePad(page);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(), path = shape === 'dot' ? [[0.5, 0.5], [0.502, 0.5]] : Array.from({length: 32}, (_, i) => [0.12 + i * 0.024, 0.5 + Math.sin(i / 3) * 0.28]);
  const at = ([x, y]) => ({x: box.x + x * box.width, y: box.y + y * box.height});
  if (input === 'mouse') {
    await page.mouse.move(at(path[0]).x, at(path[0]).y); await page.mouse.down();
    for (const point of path.slice(1)) await page.mouse.move(at(point).x, at(point).y, {steps: 2});
    await page.mouse.up();
  } else if (input === 'touch') {
    const cdp = await page.context().newCDPSession(page), touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: point ? [{x: at(point).x, y: at(point).y, id: 1}] : []});
    await touch('touchStart', path[0]);
    for (const point of path.slice(1)) await touch('touchMove', point);
    await touch('touchEnd'); await cdp.detach();
  } else await canvas.evaluate((element, points) => {
    const rect = element.getBoundingClientRect(), event = (type, [x, y], buttons = 1) => new PointerEvent(type, {pointerId: 9, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, pressure: 0.6, button: 0, buttons, clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height});
    element.dispatchEvent(event('pointerdown', points[0]));
    for (const point of points.slice(1)) element.dispatchEvent(event('pointermove', point));
    element.dispatchEvent(event('pointerup', points.at(-1), 0));
  }, path);
}

/** Whether the pad holds ink (any pixel drawn on its canvas). */
export const padInked = page => signaturePad(page).evaluate(canvas => { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 3; i < data.length; i += 4) if (data[i]) return true; return false; });

/** The customer signs and the request is sent: who signs, the drawing, then «تأكيد وإرسال» (confirm: its English «Confirm and send»). */
export async function signRequest(page, {signer = 'م. خالد العتيبي', input = 'mouse', confirm = 'تأكيد وإرسال'} = {}) {
  const step = page.locator('.mold-dialog .mold-signing');
  await step.waitFor();
  await step.locator('input[name="signer"]').fill(signer);
  await drawSignature(page, {input});
  await step.getByRole('button', {name: confirm}).click();
}
