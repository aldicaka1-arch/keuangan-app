import { supabase, BUCKET } from "./supabase";

// Fields kept in the single-row settings blob (everything that isn't tx/asset).
const SETTINGS_KEYS = [
  "pin",
  "accounts",
  "catIn",
  "catOut",
  "descriptions",
  "openingHutang",
  "openingPiutang",
  "budgets",
];

function pickSettings(data) {
  const out = {};
  for (const k of SETTINGS_KEYS) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

// Current authenticated user id (throws if not logged in).
async function getUid() {
  const { data } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) throw new Error("Sesi tidak ditemukan. Silakan login ulang.");
  return id;
}

// ---- mappers (JS camelCase <-> DB snake_case) ----
function rowToTx(r) {
  return {
    id: r.id,
    tipe: r.tipe,
    tanggal: r.tanggal,
    kategori: r.kategori,
    akun: r.akun,
    keterangan: r.keterangan,
    jumlah: Number(r.jumlah) || 0,
    hasPhoto: !!r.has_photo,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function txToRow(t) {
  return {
    id: t.id,
    tipe: t.tipe,
    tanggal: t.tanggal,
    kategori: t.kategori ?? null,
    akun: t.akun ?? null,
    keterangan: t.keterangan ?? null,
    jumlah: Number(t.jumlah) || 0,
    has_photo: !!t.hasPhoto,
    created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
  };
}
function rowToAsset(r) {
  return {
    id: r.id,
    nama: r.nama,
    jenis: r.jenis,
    nilai: Number(r.nilai) || 0,
    tanggal: r.tanggal,
    keterangan: r.keterangan,
    hasPhoto: !!r.has_photo,
  };
}
function assetToRow(a) {
  return {
    id: a.id,
    nama: a.nama ?? null,
    jenis: a.jenis ?? null,
    nilai: Number(a.nilai) || 0,
    tanggal: a.tanggal ?? null,
    keterangan: a.keterangan ?? null,
    has_photo: !!a.hasPhoto,
  };
}

// ---- data ----
export async function loadAll() {
  const uid = await getUid();
  const [settingsRes, txRes, assetRes] = await Promise.all([
    supabase.from("keuangan_settings").select("data").eq("user_id", uid).maybeSingle(),
    supabase.from("keuangan_transactions").select("*").order("tanggal", { ascending: false }),
    supabase.from("keuangan_assets").select("*").order("created_at", { ascending: false }),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (txRes.error) throw txRes.error;
  if (assetRes.error) throw assetRes.error;
  return {
    settings: settingsRes.data?.data || {},
    transactions: (txRes.data || []).map(rowToTx),
    assets: (assetRes.data || []).map(rowToAsset),
  };
}

export async function saveSettings(data) {
  const uid = await getUid();
  const { error } = await supabase
    .from("keuangan_settings")
    .upsert(
      { user_id: uid, data: pickSettings(data), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

export async function upsertTransaction(tx) {
  const uid = await getUid();
  const { error } = await supabase.from("keuangan_transactions").upsert({ ...txToRow(tx), user_id: uid });
  if (error) throw error;
}
export async function deleteTransaction(id) {
  const { error } = await supabase.from("keuangan_transactions").delete().eq("id", id);
  if (error) throw error;
}
export async function upsertAsset(asset) {
  const uid = await getUid();
  const { error } = await supabase.from("keuangan_assets").upsert({ ...assetToRow(asset), user_id: uid });
  if (error) throw error;
}
export async function deleteAsset(id) {
  const { error } = await supabase.from("keuangan_assets").delete().eq("id", id);
  if (error) throw error;
}

// ---- photos (Storage, private bucket + signed URLs) ----
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

const photoPath = (uid, id) => `${uid}/${id}.jpg`;

export async function savePhoto(id, dataUrl) {
  const uid = await getUid();
  const blob = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(photoPath(uid, id), blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}
export async function loadPhoto(id) {
  const uid = await getUid();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(photoPath(uid, id), 3600);
  if (error) return null;
  return data?.signedUrl || null;
}
export async function delPhoto(id) {
  const uid = await getUid();
  await supabase.storage.from(BUCKET).remove([photoPath(uid, id)]);
}
