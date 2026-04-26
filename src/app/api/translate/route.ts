import { NextRequest, NextResponse } from 'next/server';

function repairJSON(raw: string): string {
  let s = raw.replace(/```json|```/g, '').trim();
  const lastGood = s.lastIndexOf('}');
  if (lastGood !== -1) s = s.slice(0, lastGood + 1);
  const opens  = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  const braces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  for (let i = 0; i < braces; i++) s += '}';
  for (let i = 0; i < opens;  i++) s += ']';
  return s;
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
- If you see a menu, return EACH dish as a separate entry
- Keep translations under 60 characters
- Do NOT skip any text

${mode === 'quick' ? 'Return only the 5 most prominent items.' : 'Return ALL items. Be thorough.'}

If no Vietnamese text exists return {"items":[]}.

Respond ONLY with valid JSON, no markdown, no explanation:
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
    console.log('Groq raw response (first 500 chars):', raw.slice(0, 500));

    // Try parse as-is
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      console.log('Parsed successfully, items:', parsed?.items?.length ?? 0);
      return NextResponse.json(parsed);
    } catch (e1) {
      console.warn('Initial parse failed, attempting repair. Error:', e1);
      // Attempt repair
      try {
        const repaired = repairJSON(raw);
        console.log('Repaired JSON (first 300):', repaired.slice(0, 300));
        const parsed = JSON.parse(repaired);
        console.log('Repaired parse OK, items:', parsed?.items?.length ?? 0);
        return NextResponse.json(parsed);
      } catch (e2) {
        console.error('Repair also failed:', e2);
        console.error('Full raw response:', raw);
        return NextResponse.json({ items: [], error: 'Could not parse model response' });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Fetch error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
