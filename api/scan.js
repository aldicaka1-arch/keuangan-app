// api/scan.js
export default async function handler(req, res) {
  // CORS headers - allow requests from frontend
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, categories } = req.body;

  // Validation
  if (!imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'categories array is required' });
  }

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const prompt = `Kamu membaca foto struk belanja Indonesia. Balas HANYA JSON valid tanpa teks atau markdown lain, format:
{"total": number, "tanggal": "YYYY-MM-DD" atau null, "merchant": string, "kategori": string, "keterangan": string}

Aturan:
- total = jumlah akhir yang dibayar, angka saja tanpa titik atau koma.
- kategori = pilih dari: [${categories.join(', ')}]. Jika ragu pilih "Lainnya".
- keterangan = ringkas, nama toko + isi singkat.
- tanggal = extract dari struk format YYYY-MM-DD, jika tidak ada gunakan null.
- merchant = nama toko/tempat belanja.

Jika bukan struk atau tidak bisa dibaca, balas HANYA:
{"error":"tidak terbaca"}

HANYA JSON, TANPA TEKS LAIN!`;

  try {
    console.log('Calling Anthropic API...');
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBase64,
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

    // Check if response is OK
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Anthropic API error:', errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'API call failed',
        code: errorData.error?.type,
      });
    }

    const apiResponse = await response.json();
    console.log('API response:', apiResponse);

    // Extract text from response
    const textContent = apiResponse.content?.[0]?.text;
    
    if (!textContent) {
      return res.status(500).json({ error: 'Empty response from API' });
    }

    console.log('Extracted text:', textContent);

    // Parse JSON from response
    let parsedData;
    try {
      parsedData = JSON.parse(textContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Response text:', textContent);
      
      // Try to extract JSON from text if wrapped in markdown
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedData = JSON.parse(jsonMatch[0]);
        } catch (e) {
          return res.status(400).json({
            error: 'Invalid JSON response from API',
            raw: textContent.substring(0, 100),
          });
        }
      } else {
        return res.status(400).json({
          error: 'Could not parse response',
          raw: textContent.substring(0, 100),
        });
      }
    }

    // Return success
    return res.status(200).json({
      success: true,
      data: parsedData,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({
      error: err.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
}