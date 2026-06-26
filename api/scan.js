export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { imageBase64, categories } = req.body;
  const prompt = `Kamu membaca foto struk belanja Indonesia. Balas HANYA JSON valid tanpa teks atau markdown lain, format:
{"total": number, "tanggal": "YYYY-MM-DD" atau null, "merchant": string, "kategori": string, "keterangan": string}
Aturan:
- total = jumlah akhir yang dibayar, angka saja tanpa titik atau koma.
- kategori = pilih dari: [${categories}]. Jika ragu pilih "Lainnya".
- keterangan = ringkas, nama toko + isi singkat.
Jika bukan struk, balas {"error":"tidak terbaca"}.`;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt },
        ]}],
      }),
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}