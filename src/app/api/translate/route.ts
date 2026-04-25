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

  const prompt = [
    'You are a Vietnamese OCR and translation engine.',
    'Examine this image and locate every piece of Vietnamese text.',
    'For each text region return a JSON entry with:',
    '  "original"    – the Vietnamese text as written',
    '  "translation" – the English translation',
    '  "context"     – brief label (e.g. sign, menu, label, heading)',
    '  "x"  – left edge of text bounding box as % of image WIDTH  (0-100)',
    '  "y"  – top  edge of text bounding box as % of image HEIGHT (0-100)',
    '  "w"  – width  of bounding box as % of image WIDTH  (1-100)',
    '  "h"  – height of bounding box as % of image HEIGHT (1-100)',
    '',
    'x,y,w,h must accurately reflect where the text physically appears so it can be overlaid on the image.',
    mode === 'quick'
      ? 'Be fast — only return the most prominent text regions (max 5).'
      : 'Be thorough — return ALL Vietnamese text visible in the image.',
    'If there is no Vietnamese text return {"items":[]}.',
    'Respond ONLY with valid JSON, no markdown fences, no explanation:',
    '{"items":[{"original":"...","translation":"...","context":"...","x":10,"y":20,"w":30,"h":5}]}',
  ].join('\n');

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 1500,
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
