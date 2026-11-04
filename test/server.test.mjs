import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefinePrompt, buildSwapInput, extractApiKey, isValidOpenAIKey, safeOutputName, seoulTimestamp } from '../server.mjs';

const image = 'data:image/png;base64,AAAA';

test('buildSwapInput creates fixed prompt and ordered product images', () => {
  const input = buildSwapInput({ background: image, products: [image, image], garmentCount: 5 });
  assert.equal(input.length, 4);
  assert.equal(input[1].type, 'image');
  assert.match(input[0].text, /PRODUCT AND HANGER references/);
  assert.match(input[0].text, /horizontal clip-style pants hanger must remain/);
  assert.match(input[0].text, /replace the original hanger hardware/);
  assert.match(input[0].text, /exactly one hanger and exactly one garment at each locked slot/);
  assert.match(input[0].text, /garments already hanging/);
  assert.match(input[0].text, /16:9 at 1920x1080/);
  assert.match(input[0].text, /color temperature, white balance/);
  assert.match(input[0].text, /sole authority for scene composition, garment count, rail connection coordinates/);
  assert.match(input[0].text, /Preserve the target's original angle and perspective/);
  assert.match(input[0].text, /long coat must remain visibly long/);
  assert.match(input[0].text, /Never compress, shorten or stretch a product/);
  assert.match(input[0].text, /PRODUCT references control hanger type and shape/);
  assert.match(input[0].text, /There are exactly 2 supplied product references/);
  assert.match(input[0].text, /exactly 5 original garment positions/);
  assert.match(input[0].text, /result with 6 or more garments is invalid/);
  assert.match(input[0].text, /black, gray, ivory, black, ivory/);
  assert.match(input[0].text, /no unuploaded garment, hanger type or color may appear/);
});

test('buildSwapInput adds a position guide after products', () => {
  const anchors = [{ x: 0.42, y: 0.2093 }, { x: 0.451, y: 0.2093 }];
  const input = buildSwapInput({ background: image, products: [image], garmentCount: 2, anchorGuide: image, hangerAnchors: anchors });
  assert.equal(input.length, 4);
  assert.match(input[0].text, /Image 3 is a POSITION GUIDE only/);
  assert.match(input[0].text, /1=\(0.4200,0.2093\)/);
  assert.match(input[0].text, /preserve the original uneven spacing and group gaps/);
  assert.match(input[0].text, /Do not copy the guide's white background, dots, numbers, lines or labels/);
});

test('buildRefinePrompt assigns source and reference roles', () => {
  const prompt = buildRefinePrompt('오른쪽 바지만 네이비로 변경', 2);
  assert.match(prompt, /Image 1 is the immutable SOURCE RESULT/);
  assert.match(prompt, /Images 2 through 3 are REFERENCE IMAGES only/);
  assert.match(prompt, /오른쪽 바지만 네이비로 변경/);
  assert.match(prompt, /Preserve every unmentioned part/);
  assert.match(prompt, /hanger count, hanger coordinates, garment count, spacing/);
});

test('extractApiKey accepts raw and env formatted OpenAI keys', () => {
  assert.equal(extractApiKey('AIza-example'), 'AIza-example');
  assert.equal(extractApiKey('OPENAI_API_KEY="sk-example"'), 'sk-example');
});

test('isValidOpenAIKey accepts OpenAI user keys and rejects invalid input', () => {
  assert.equal(isValidOpenAIKey('sk-proj-1234567890abcdef'), true);
  assert.equal(isValidOpenAIKey('not-a-key'), false);
  assert.equal(isValidOpenAIKey(''), false);
});

test('output names use Seoul date and safe background filename', () => {
  assert.equal(seoulTimestamp(new Date('2026-11-02T15:00:00Z')), '20261103');
  assert.equal(safeOutputName('상수.png'), '상수');
  assert.equal(safeOutputName('새:배경?.jpg'), '새_배경_');
});
