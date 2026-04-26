import { NextRequest, NextResponse } from 'next/server';

// Attempt to salvage truncated JSON by closing any open structures
function repairJSON(raw: string): string {
  let s = raw.replace(/```json|```/g, '').trim();

  // Find the last complete item by cutting at the last complete closing brace
  const lastGood = s.lastIndexOf('}');
  if (lastGood !== -1) {
    s = s.slice(0, lastGood + 1);
  }

  // Close any open array/object
  const opens = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  const braces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;

  for (let i = 0; i < braces; i++) s += '}';
  for (let i = 0; i < opens; i++) s += ']';

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

  const prompt = `You are a Vietnamese OCR and translation engine for restaurant menus.

Find Vietnamese text in this image and return JSON.

Rules:
- Each menu item = one entry
- Include price in the translation e.g. "Beef Noodle Soup $18.00"
- Bounding box should be tight around the text only
- x,y,w,h are percentages of image dimensions (0-100)
- Keep translations SHORT (under 60 characters)

${mode === 'quick' ? 'Return max 5 items.' : 'Return all items you can see.'}

Return ONLY this JSON format with no extra text:
{"items":[{"original":"Phở bò","translation":"Beef Noodle Soup $18","context":"menu item","x":5,"y":20,"w":45,"h":4}]}

If no Vietnamese text: {"items":[]}`;

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
      return NextResponse.json({ error: data.error.message }, { status: 502 });
    }

    const raw = data.choices?.[0]?.message?.content ?? '';

    // Try parsing as-is first, then attempt repair
    let parsed: { items: unknown[] };
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      try {
        const repaired = repairJSON(raw);
        parsed = JSON.parse(repaired);
      } catch {
        // Last resort: return empty items rather than crashing
        parsed = { items: [] };
      }
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
