require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow largish JSON bodies since we send images as base64 data URLs
app.use(express.json({ limit: '15mb' }));

// Serve the frontend (public/index.html and any assets you add)
app.use(express.static(path.join(__dirname, 'public')));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'openrouter/free'; // free, vision-capable Qwen model on OpenRouter

const VALID_CATEGORIES = ['black', 'yellow', 'red', 'white', 'blue'];

app.post('/api/scan', async (req, res) => {
  try {
    const { imageDataUrl } = req.body;

    if (!imageDataUrl) {
      return res.status(400).json({ error: 'No image was provided.' });
    }
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'Server is missing an OpenRouter API key. Check the .env file.' });
    }

    const prompt = `You are a biomedical waste segregation assistant, following India's Bio-Medical Waste Management Rules, 2016.
Look at the image and identify the medical waste item shown.
Respond with ONLY a valid JSON object — no markdown, no code fences, no extra commentary — in exactly this shape:
{
  "itemName": "short name of the item",
  "category": "one of: black, yellow, red, white, blue",
  "instructions": "one or two sentences on how to dispose of it correctly",
  "warning": "one sentence on the safety risk if disposed of incorrectly"
}

Category meanings:
- black = general non-hazardous solid waste (food waste, packaging, office/garden waste)
- yellow = soiled waste: dressings, cotton, plaster casts, human anatomical waste, expired medicines (yellow bag)
- red = contaminated recyclable plastics: IV tubing/bottles, catheters, urine bags, syringes WITHOUT needles (red bag)
- white = sharps: needles, syringes WITH fixed needles, scalpels, blades (puncture-proof white container)
- blue = glassware: broken vials, ampoules, metallic implants (blue box)

If the image doesn't clearly show medical waste, make your best guess and mention the uncertainty inside "instructions".`;

    const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ],
        max_tokens: 400
      })
    });

    if (!orResponse.ok) {
      const errText = await orResponse.text();
      console.error('OpenRouter error:', orResponse.status, errText);
      return res.status(502).json({ error: 'The AI model could not process the image right now. Please try again in a moment.' });
    }

    const data = await orResponse.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!raw) {
      console.error('Unexpected OpenRouter response shape:', JSON.stringify(data));
      return res.status(502).json({ error: 'The AI model returned an empty response.' });
    }

    // Strip stray markdown fences in case the model adds them anyway
    const cleaned = raw.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Could not parse model output as JSON:', cleaned);
      return res.status(502).json({ error: 'Could not understand the AI response. Please try a clearer photo.' });
    }

    if (!VALID_CATEGORIES.includes(parsed.category)) {
      parsed.category = 'black'; // safe fallback so the frontend never breaks
    }

    res.json(parsed);
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Something went wrong while scanning the image.' });
  }
});

app.listen(PORT, () => {
  console.log(`MediSort server running at http://localhost:${PORT}`);
});
