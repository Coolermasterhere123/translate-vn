import { NextRequest, NextResponse } from 'next/server';

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
- "translation": accurate English translation
- "context": what type of text (e.g. "menu item", "price", "section heading", "description", "sign", "label")
- "x": left edge of bounding box as % of image WIDTH (0-100)
- "y": top edge of bounding box as % of image HEIGHT (0-100)
- "w": width of bounding box as % of image WIDTH (1-100)
- "h": height of bounding box as % of image HEIGHT (1-100)

IMPORTANT:
- Return EVERY text item separately — each menu item on its own line gets its own entry
- Bounding boxes must match exactly where the text appears in the image
- If you see a menu, return EACH dish/item as a separate entry
- Include prices as separate entries
- Do NOT skip any text

${mode === 'quick' ? 'Return only the 5 most prominent text items.' : 'Return ALL text items you can find. Be thorough.'}

If no Vietnamese text exists return {"items":[]}.

Respond ONLY with valid JSON, no markdown, no explanation:
{"items":[{"original":"Phở bò","translation":"Beef Noodle Soup","context":"menu item","x":10,"y":20,"w":40,"h":5}]}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMime};base64,${imageBase64}`,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const data = await groqRes.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 502 });
    }

    const raw   = data.choices?.[0]?.message?.content ?? '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
