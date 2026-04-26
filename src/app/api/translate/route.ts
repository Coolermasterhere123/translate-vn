import { NextRequest, NextResponse } from 'next/server';

// Extract JSON from messy model output
function extractJSON(raw: string): { items: unknown[] } {
  // Strip markdown fences
  let s = raw.replace(/```json|```/g, '').trim();

  // Try direct parse first
  try {
    return JSON.parse(s);
  } catch {}

  // Find the outermost { ... } block
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {}
  }

  // Try to find and collect all complete item objects manually
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

  // Last resort — try fixing truncated JSON by closing open brackets
  try {
    let fixed = s;
    // Cut off at the last complete closing brace before any truncation
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

  const prompt = `You are an expert Vietnamese OCR and translation engine specializing in restaurant menus, street signs, product labels, and all printed Vietnamese text.

TASK: Carefully examine this image and find EVERY piece of Vietnamese text — including menu item names, prices, descriptions, headings, labels, signs, and any other text.

Vietnamese text uses diacritical marks (like ắ, ổ, ề, ươ, đ, etc). Look carefully for these characters.

For EACH text region found, return:
- "original": exact Vietnamese text as it appears
- "translation": accurate English translation, include price if visible e.g. "Beef Noodle Soup $18.00"
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

You MUST respond with ONLY valid JSON in exactly this format:
{"items":[{"original":"Phở bò","translation":"Beef Noodle Soup $18","context":"menu item","x":5,"y":20,"w":45,"h":4}]}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
              {
                type: 'image_url',
                image_url: { url: `data:${imageMime};base64,${imageBase64}` },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await groqRes.json();

    if (data.error) {
      console.error('Groq API error:', data.error);
      return NextResponse.json({ error: data.error.message }, { status: 502 });
    }

    const raw = data.choices?.[0]?.message?.content ?? '';
    console.log('Groq raw (first 300):', raw.slice(0, 300));

    try {
      const parsed = extractJSON(raw);
      console.log('Parsed OK, items:', (parsed.items ?? []).length);
      return NextResponse.json(parsed);
    } catch (e) {
      console.error('All parse attempts failed:', e);
      console.error('Full raw:', raw);
      // Return empty rather than error so the app shows "No text found" instead of crashing
      return NextResponse.json({ items: [] });
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Fetch error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
