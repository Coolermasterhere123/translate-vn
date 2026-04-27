import { NextRequest, NextResponse } from 'next/server';

// Fetch live VND → CAD rate, fall back to approximate if unavailable
async function getVndToCad(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/VND', { next: { revalidate: 3600 } });
    const data = await res.json();
    if (data?.rates?.CAD) return data.rates.CAD;
  } catch {}
  // Fallback: ~1 VND = 0.000054 CAD (approx)
  return 0.000054;
}

// Extract and convert VND prices in a translation string
function convertVndToCad(text: string, rate: number): string {
  // Match patterns like 50.000đ, 50,000₫, 150000 VND, 50.000 VND etc.
  return text.replace(
    /(\d[\d.,]*)\s*(₫|đ|VND|vnd|dong)/gi,
    (_, amount, unit) => {
      const num = parseFloat(amount.replace(/[.,]/g, '').replace(/(\d+)[.,](\d{3})/g, '$1$2')) ;
      const clean = parseFloat(amount.replace(/\./g, '').replace(',', '.'));
      const vnd = isNaN(num) ? clean : num;
      const cad = vnd * rate;
      const cadStr = cad >= 1 ? `$${cad.toFixed(2)} CAD` : `$${cad.toFixed(4)} CAD`;
      return `${amount}${unit} (${cadStr})`;
    }
  );
}

function extractJSON(raw: string): { items: unknown[] } {
  let s = raw.replace(/```json|```/g, '').trim();

  try { return JSON.parse(s); } catch {}

  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }

  const items: unknown[] = [];
  const itemRegex = /\{[^{}]*"original"\s*:\s*"[^"]*"[^{}]*"translation"\s*:\s*"[^"]*"[^{}]*\}/g;
  let match;
  while ((match = itemRegex.exec(s)) !== null) {
    try {
      const item = JSON.parse(match[0]);
      if (item.original && item.translation) items.push(item);
    } catch {}
  }
  if (items.length > 0) return { items };

  try {
    let fixed = s;
    const lastBrace = fixed.lastIndexOf('}');
    if (lastBrace !== -1) fixed = fixed.slice(0, lastBrace + 1);
    const opens  = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
    const braces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
    for (let i = 0; i < braces; i++) fixed += '}';
    for (let i = 0; i < opens;  i++) fixed += ']';
    return JSON.parse(fixed);
  } catch {}

  throw new Error('Could not extract JSON from response');
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  let body: { imageBase64: string; imageMime?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { imageBase64, imageMime = 'image/jpeg', mode = 'full' } = body;
  if (!imageBase64) {
    return NextResponse.json({ error: 'imageBase64 is required' }, { status: 400 });
  }

  // Fetch live exchange rate in parallel with the model call
  const vndToCadPromise = getVndToCad();

  const prompt = `You are an expert Vietnamese OCR and translation engine specializing in restaurant menus, street signs, product labels, and all printed Vietnamese text.

TASK: Carefully examine this image and find EVERY piece of Vietnamese text — including menu item names, prices, descriptions, headings, labels, signs, and any other text.

Vietnamese text uses diacritical marks (like ắ, ổ, ề, ươ, đ, etc). Look carefully for these characters.

For EACH text region found, return:
- "original": exact Vietnamese text as it appears
- "translation": accurate English translation. If the menu shows prices in CAD/USD already, include them as-is. If prices are in Vietnamese Dong (₫, đ, VND), include the original dong amount in the translation.
- "context": type of text (e.g. "menu item", "section heading", "sign", "label")
- "x": left edge of bounding box as % of image WIDTH (0-100)
- "y": top edge of bounding box as % of image HEIGHT (0-100)
- "w": width of bounding box as % of image WIDTH (1-100)
- "h": height of bounding box as % of image HEIGHT (1-100)

IMPORTANT:
- Return EVERY text item separately
- Bounding boxes must be TIGHT — only as wide as the actual text
- Keep translations under 60 characters
- Do NOT include any explanation or text outside the JSON

${mode === 'quick' ? 'Return only the 5 most prominent items.' : 'Return ALL items. Be thorough.'}

If no Vietnamese text exists return {"items":[]}.

Respond ONLY with valid JSON:
{"items":[{"original":"Phở bò 50.000₫","translation":"Beef Noodle 50.000₫","context":"menu item","x":5,"y":20,"w":45,"h":4}]}`;

  try {
    const [groqRes, vndToCad] = await Promise.all([
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
      }),
      vndToCadPromise,
    ]);

    const data = await groqRes.json();

    if (data.error) {
      console.error('Groq API error:', data.error);
      return NextResponse.json({ error: data.error.message }, { status: 502 });
    }

    const raw = data.choices?.[0]?.message?.content ?? '';
    console.log('Groq raw (first 300):', raw.slice(0, 300));
    console.log('VND→CAD rate:', vndToCad);

    try {
      const parsed = extractJSON(raw) as { items: Array<{ translation?: string }> };

      // Convert any VND prices in translations to CAD
      if (parsed.items && vndToCad) {
        parsed.items = parsed.items.map(item => ({
          ...item,
          translation: item.translation ? convertVndToCad(item.translation, vndToCad) : item.translation,
        }));
      }

      console.log('Parsed OK, items:', parsed.items?.length ?? 0);
      return NextResponse.json(parsed);
    } catch (e) {
      console.error('All parse attempts failed:', e);
      return NextResponse.json({ items: [] });
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Fetch error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
