import { createServer } from 'node:http';
import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const backgroundDir = normalize(process.env.CLOTHING_SWAP_BACKGROUND_DIR || join(root, '..', '01_INPUT', 'BG'));
const outputDir = normalize(process.env.CLOTHING_SWAP_OUTPUT_DIR || join(root, '..', '02_OUTPUT'));
const port = Number(process.env.PORT || 4175);
const openaiImageEndpoint = 'https://api.openai.com/v1/images/edits';
// Client images are downscaled before upload. Keep enough headroom for six
// transparent PNG product references plus a background and position guide.
const maxBytes = 96 * 1024 * 1024;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
let sessionOpenAIKey = '';

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function extractApiKey(source) {
  const lines = String(source || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const preferred = lines.find((line) => /^(OPENAI_API_KEY|API_KEY)\s*=/i.test(line));
  const candidate = preferred || lines[0] || '';
  return candidate.includes('=') ? candidate.slice(candidate.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') : candidate;
}

export function isValidOpenAIKey(value) {
  return /^sk-[A-Za-z0-9_\-]{16,}$/.test(String(value || '').trim());
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function buildSwapInput({ background, products, garmentCount, anchorGuide = null, hangerAnchors = [] }) {
  const productList = Array.isArray(products) ? products : [];
  if (!productList.length) throw new Error('INVALID_IMAGE');
  const productCount = productList.length;
  const fixedCount = Number.isInteger(garmentCount) && garmentCount > 0 ? garmentCount : null;
  const slotCount = fixedCount ? String(fixedCount) : 'S';
  const countInstruction = fixedCount
    ? `The MASTER SCENE has exactly ${fixedCount} original garment positions and exactly ${fixedCount} hangers. This count has already been verified; do not recount it. The final image must show exactly ${fixedCount} garments on exactly ${fixedCount} original hangers. A result with ${fixedCount + 1} or more garments is invalid.`
    : 'First count the original hanging garment positions in Image 1; call this number S. The final scene must contain exactly S hanging garments, preserving every original garment position.';
  const anchorList = Array.isArray(hangerAnchors) ? hangerAnchors : [];
  const guideImageNumber = productCount + 2;
  const guideInstruction = anchorGuide && anchorList.length
    ? `Image ${guideImageNumber} is a POSITION GUIDE only, not scene content. It marks the ${anchorList.length} locked hanger-to-rail connection slots with numbered points. The normalized slot coordinates are ${anchorList.map((point, index) => `${index + 1}=(${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)})`).join(', ')}. Use these points to preserve the original uneven spacing and group gaps. Do not copy the guide's white background, dots, numbers, lines or labels into the result.`
    : 'No separate position guide is supplied; derive the original hanger connection slots only from Image 1.';
  const text = `You are performing a precise product-only garment replacement edit.
Image 1 is the immutable MASTER SCENE and the sole authority for scene composition, garment count, rail connection coordinates, spacing, position, orientation and camera perspective. Images 2 through ${productCount + 1} are PRODUCT AND HANGER references, ordered left-to-right for the existing hanging garment positions. The product references are the sole authority for each garment's hanger type, hanger shape and garment-to-hanger attachment method.
${guideInstruction}
There are exactly ${productCount} supplied product references. ${countInstruction}
Assign the ${productCount} supplied products once in upload order from left to right. If ${slotCount} is greater than ${productCount}, fill only the remaining ${slotCount} - ${productCount} positions by reusing selected supplied products. Reuse must come exclusively from the supplied references: never invent, blend, retain or introduce a garment, design or color that was not uploaded. Distribute reused products for visual variety rather than starting a full sequential cycle again. Required example: when the verified count is 5 and the three uploaded products are black, gray and ivory, the five positions must be black, gray, ivory, black, ivory (product references 1, 2, 3, 1, 3). If only one product is supplied, repeat that product in all ${slotCount} positions. If ${slotCount} is smaller than the product count, use only the first ${slotCount} products.
Identify all garments already hanging in Image 1 and use every original garment position as a pose target. No original garment appearance may survive: each visible garment must match one of the supplied product references, including its color and design.
The output canvas must be 16:9 at 1920x1080. Preserve Image 1's framing, camera position, perspective, geometry and composition inside that canvas without stretching or cropping important scene content. Preserve Image 1's exact color palette, color temperature, white balance, exposure, brightness, contrast, saturation, material rendering, lighting direction, shadows and background.
Before rendering, establish exactly ${slotCount} immutable target slots from Image 1, one slot per original hanging garment and one rail connection coordinate per slot. Never split, duplicate, merge or create a slot. Render exactly one hanger and exactly one garment at each locked slot, and nothing between slots.
For each of the ${slotCount} target slots, copy Image 1's exact rail connection coordinate, rotation, yaw, perspective foreshortening, hanging angle, depth order, overlap relationship and spacing. These anchor and pose values are locked and must not move. Image 1 controls where the hanger connects to the rail, but it does not control the hanger type or hanger shape.
The PRODUCT references are authoritative for the garment and its hanger: preserve each product's visible hanger type, silhouette, material and attachment construction exactly. A product shown on a horizontal clip-style pants hanger must remain on that same horizontal clip-style pants hanger; never convert it into a triangular shoulder hanger. A product shown on a triangular shoulder hanger must retain that hanger. Copy the visible hook, stem, bar and clips from the corresponding product reference, then connect the top of that copied hanger to the locked rail coordinate from Image 1 with visible physical contact and correct occlusion. Never leave the hanger floating below the rail.
The PRODUCT references are also authoritative for the garment's true category and physical proportions, including shoulder-to-hem length, body width, sleeve length, collar-to-hem ratio, volume and silhouette. Analyze the actual garment pixels inside each product photo and ignore white or transparent catalog margins when measuring proportions.
Attach the product using the garment-to-hanger construction shown in its product reference, then let its body extend naturally downward according to the product's real proportion at the scene's believable scale. A long coat must remain visibly long and extend below the original short garment's hem; a cropped jacket must remain short. Never compress, shorten or stretch a product merely to fit the original garment's bounding box, height or silhouette envelope. The original garment bounding box controls neither the new hem position nor the product's length.
Preserve the target's original angle and perspective while rotating and foreshortening the product's true silhouette into that pose. If a product reference faces forward while its target garment is angled, partially side-facing, folded or overlapped, render the full product geometry at the target's original angle. Longer garments may naturally cover more of the unchanged background or overlap a neighbor, but they must not create a new hanger or garment.
Do not move rail connection anchors, straighten garments, rotate them toward the camera, center them, evenly space them or separate them. Preserve the rail and exact connection positions, but replace the original hanger hardware with the corresponding product reference's hanger hardware. Do not recolor, crop or relight Image 1. Do not add text, people, props, rails, hangers or extra garments. Change only the garments and their corresponding hanger hardware; all other content must remain visually unchanged.
FINAL CHECK BEFORE OUTPUT: the visible garment count, hanger count and occupied rail-anchor count must each equal ${slotCount}. Every locked rail anchor must have exactly one hanger, and there must be no hanger outside those anchors. Do not subdivide one original garment position into multiple garments and do not add new hangers. Every visible garment and hanger must correspond exactly to one of the ${productCount} supplied product references; repeated products are allowed only to fill original positions, and no unuploaded garment, hanger type or color may appear. MASTER SCENE controls count, rail anchors, spacing, position, angle and perspective. PRODUCT references control hanger type and shape, garment length, width, sleeves, category and silhouette proportions.`;
  return [
    { type: 'text', text },
    toImage(background),
    ...productList.map(toImage),
    ...(anchorGuide ? [toImage(anchorGuide)] : [])
  ];
}

export function buildRefinePrompt(prompt, referenceCount = 0) {
  const requestedChange = String(prompt || '').trim() || 'Use the supplied reference images to make the intended visual correction.';
  const referenceInstruction = referenceCount > 0
    ? `Images 2 through ${referenceCount + 1} are REFERENCE IMAGES only. Use them only for the visual details relevant to the requested change; do not copy their background, framing, unrelated objects or text.`
    : 'No additional reference image is supplied.';
  return `Perform a precise edit of Image 1. Image 1 is the immutable SOURCE RESULT and must remain 1920x1080 in a 16:9 composition.
${referenceInstruction}
USER REQUEST: ${requestedChange}
Change only what the user explicitly requests. Preserve every unmentioned part of Image 1, including canvas, crop, camera, background, rail, hanger count, hanger coordinates, garment count, spacing, lighting, shadows, color balance and all unaffected garments. Do not add text, extra products, extra hangers or new objects. The final output must be a clean photorealistic edited version of Image 1.`;
}

function toImage(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('INVALID_IMAGE');
  return { type: 'image', mime_type: match[1], data: match[2] };
}

export function seoulTimestamp(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

export function safeOutputName(value) {
  const withoutExtension = String(value || '배경').replace(/\.[^.]+$/, '');
  return withoutExtension.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '') || '배경';
}

async function saveOutput(request, response) {
  try {
    const { dataUrl, backgroundName } = await readBody(request);
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!match) return sendJson(response, 400, { error: { message: '저장할 PNG 결과 이미지가 없습니다.' } });
    const folder = seoulTimestamp();
    const safeName = safeOutputName(backgroundName);
    const datedDir = normalize(join(outputDir, folder));
    if (!datedDir.startsWith(outputDir)) throw new Error('BAD_PATH');
    await mkdir(datedDir, { recursive: true });
    const prefix = `${folder}_${safeName}_`;
    const existing = await readdir(datedDir);
    let sequence = existing.reduce((highest, name) => {
      if (!name.startsWith(prefix) || !name.toLowerCase().endsWith('.png')) return highest;
      const value = Number(name.slice(prefix.length, -4));
      return Number.isInteger(value) ? Math.max(highest, value) : highest;
    }, 0) + 1;
    let filename;
    let file;
    while (true) {
      filename = `${prefix}${sequence}.png`;
      file = normalize(join(datedDir, filename));
      try {
        await writeFile(file, Buffer.from(match[1], 'base64'), { flag: 'wx' });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        sequence += 1;
      }
    }
    sendJson(response, 200, { filename, folder, path: file });
  } catch (error) {
    sendJson(response, 500, { error: { message: '02_OUTPUT 폴더에 결과를 저장하지 못했습니다.' } });
  }
}

async function generate(request, response) {
  try {
    const { background, products, garmentCount, anchorGuide, hangerAnchors } = await readBody(request);
    const effectiveApiKey = sessionOpenAIKey;
    if (!effectiveApiKey) return sendJson(response, 400, { error: { message: 'OpenAI API key가 필요합니다.' } });
    const prompt = buildSwapInput({ background, products, garmentCount, anchorGuide, hangerAnchors })[0].text;
    const upstream = await fetch(openaiImageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveApiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-2.5-sunburst',
        images: [background, ...(Array.isArray(products) ? products : []), ...(anchorGuide ? [anchorGuide] : [])].map((image_url) => ({ image_url })),
        prompt,
        size: '2048x1152',
        quality: 'high',
        output_format: 'png',
        background: 'opaque',
        safety_identifier: 'clothing-swap-studio-local-user'
      }),
      signal: AbortSignal.timeout(300_000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = upstream.status === 401
        ? 'OpenAI API 키가 올바르지 않습니다.'
        : upstream.status === 429
          ? 'OpenAI API 사용 한도 또는 결제 상태를 확인해 주세요.'
          : payload?.error?.message || `OpenAI 이미지 생성 요청이 실패했습니다. (HTTP ${upstream.status})`;
      return sendJson(response, upstream.status, { error: { message } });
    }
    const image = payload?.data?.[0]?.b64_json;
    if (!image) return sendJson(response, 502, { error: { message: 'OpenAI 응답에서 결과 이미지를 찾지 못했습니다.' } });
    sendJson(response, 200, { dataUrl: `data:image/png;base64,${image}`, provider: 'openai' });
  } catch (error) {
    if (error.message === 'TOO_LARGE') return sendJson(response, 413, { error: { message: '첨부 이미지 전체 용량이 너무 큽니다. 큰 이미지를 다시 첨부하면 자동 최적화됩니다.' } });
    sendJson(response, 502, { error: { message: 'OpenAI 이미지 서버에 연결하지 못했습니다.' } });
  }
}

async function refine(request, response) {
  try {
    const { source, prompt, references } = await readBody(request);
    const referenceList = Array.isArray(references) ? references.slice(0, 6) : [];
    if (!source || (!String(prompt || '').trim() && !referenceList.length)) return sendJson(response, 400, { error: { message: '03 결과와 수정 프롬프트 또는 레퍼런스 이미지가 필요합니다.' } });
    const effectiveApiKey = sessionOpenAIKey;
    if (!effectiveApiKey) return sendJson(response, 400, { error: { message: 'OpenAI API key가 필요합니다.' } });
    const upstream = await fetch(openaiImageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveApiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-2.5-sunburst',
        images: [source, ...referenceList].map((image_url) => ({ image_url })),
        prompt: buildRefinePrompt(prompt, referenceList.length),
        size: '2048x1152',
        quality: 'high',
        output_format: 'png',
        background: 'opaque',
        safety_identifier: 'clothing-swap-studio-local-user'
      }),
      signal: AbortSignal.timeout(300_000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = upstream.status === 401
        ? 'OpenAI API 키가 올바르지 않습니다.'
        : upstream.status === 429
          ? 'OpenAI API 사용 한도 또는 결제 상태를 확인해 주세요.'
          : payload?.error?.message || `OpenAI 이미지 수정 요청이 실패했습니다. (HTTP ${upstream.status})`;
      return sendJson(response, upstream.status, { error: { message } });
    }
    const image = payload?.data?.[0]?.b64_json;
    if (!image) return sendJson(response, 502, { error: { message: 'OpenAI 응답에서 수정 이미지를 찾지 못했습니다.' } });
    sendJson(response, 200, { dataUrl: `data:image/png;base64,${image}`, provider: 'openai' });
  } catch (error) {
    if (error.message === 'TOO_LARGE') return sendJson(response, 413, { error: { message: '첨부 이미지 전체 용량이 너무 큽니다. 큰 이미지를 다시 첨부하면 자동 최적화됩니다.' } });
    sendJson(response, 502, { error: { message: 'OpenAI 이미지 수정 서버에 연결하지 못했습니다.' } });
  }
}

async function configureSessionKey(request, response) {
  try {
    const { apiKey } = await readBody(request);
    const candidate = extractApiKey(apiKey);
    if (!isValidOpenAIKey(candidate)) return sendJson(response, 400, { error: { message: '올바른 OpenAI API 키를 입력해 주세요.' } });
    sessionOpenAIKey = candidate;
    sendJson(response, 200, { openaiApiKeyReady: true });
  } catch {
    sendJson(response, 400, { error: { message: 'OpenAI API 키를 적용하지 못했습니다.' } });
  }
}

async function listBackgrounds(response) {
  const packagedBackgroundNames = new Map([
    ['upper', '상수'],
    ['lower', '하수'],
    ['ellaconic-lower', '엘라코닉 하수']
  ]);
  const knownGarmentCounts = new Map([['상수', 3], ['하수', 5]]);
  const knownHangerAnchors = new Map([
    ['상수', [{ x: 0.1906, y: 0.1620 }, { x: 0.2307, y: 0.1620 }, { x: 0.2724, y: 0.1620 }]],
    ['하수', [{ x: 0.4200, y: 0.2093 }, { x: 0.4510, y: 0.2093 }, { x: 0.4781, y: 0.2093 }, { x: 0.5927, y: 0.2093 }, { x: 0.6369, y: 0.2093 }]]
  ]);
  const files = (await readdir(backgroundDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => {
      const storedBaseName = entry.name.replace(/\.[^.]+$/, '');
      const displayBaseName = packagedBackgroundNames.get(storedBaseName) || storedBaseName;
      const displayName = `${displayBaseName}${extname(entry.name)}`;
      return { name: displayName, url: `/backgrounds/${encodeURIComponent(entry.name)}`, garmentCount: knownGarmentCounts.get(displayBaseName) || null, hangerAnchors: knownHangerAnchors.get(displayBaseName) || [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  sendJson(response, 200, { backgrounds: files });
}

async function serveBackground(pathname, response) {
  const filename = basename(decodeURIComponent(pathname.slice('/backgrounds/'.length)));
  if (!imageExtensions.has(extname(filename).toLowerCase())) throw new Error('BAD_FILE');
  const file = normalize(join(backgroundDir, filename));
  if (!file.startsWith(backgroundDir)) throw new Error('BAD_FILE');
  response.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(await readFile(file));
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { ok: true });
    if (request.method === 'GET' && pathname === '/api/config') return sendJson(response, 200, { openaiApiKeyReady: Boolean(sessionOpenAIKey) });
    if (request.method === 'POST' && pathname === '/api/session-key') return configureSessionKey(request, response);
    if (request.method === 'GET' && pathname === '/api/backgrounds') return listBackgrounds(response);
    if (request.method === 'GET' && pathname.startsWith('/backgrounds/')) return serveBackground(pathname, response);
    if (request.method === 'POST' && pathname === '/api/swap') return generate(request, response);
    if (request.method === 'POST' && pathname === '/api/refine') return refine(request, response);
    if (request.method === 'POST' && pathname === '/api/save-output') return saveOutput(request, response);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = normalize(join(root, relative));
    if (!resolved.startsWith(root)) throw new Error('BAD_PATH');
    const info = await stat(resolved);
    const file = info.isDirectory() ? join(resolved, 'index.html') : resolved;
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  server.listen(port, '127.0.0.1', () => console.log(`Clothing Swap Studio: http://localhost:${port}`));
}

export { server };
