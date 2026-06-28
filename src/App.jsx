import { useState, useEffect, useMemo, useRef, Component } from "react";
import { Wallet, TrendingUp, TrendingDown, Plus, Lock, Unlock, Settings as SettingsIcon, Home, List, BarChart3, Camera, X, Trash2, Pencil, Target, Tag, CreditCard, Search, Save, ChevronRight, Car, Bike, MapPin, Package, Building2, Gem, Coins, Sparkles, Wallet as WalletIcon, LogOut, Mail, KeyRound, Languages } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { savePhoto, loadPhoto, delPhoto, loadAll, saveSettings, upsertTransaction, deleteTransaction as dbDeleteTx, upsertAsset, deleteAsset as dbDeleteAsset } from "./lib/db";
import { supabase, consumeAuthHashError } from "./lib/supabase";
import { useI18n } from "./lib/i18n";

const STORE_KEY = "keuangan-data-v1";
const todayStr = () => new Date().toISOString().slice(0, 10);
const curMonth = () => new Date().toISOString().slice(0, 7);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const rupiah = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const parseNum = (s) => Number(String(s).replace(/[^\d-]/g, "")) || 0;
const fmtThousand = (n) => (n ? Number(n).toLocaleString("id-ID") : "");

function mergeLoadedData(settings, transactions, assets) {
  const s = settings || {};
  return {
    ...DEFAULT,
    ...s,
    transactions: transactions || [],
    assets: assets || [],
    accounts: Array.isArray(s.accounts) ? s.accounts : DEFAULT.accounts,
    catIn: Array.isArray(s.catIn) ? s.catIn : DEFAULT.catIn,
    catOut: Array.isArray(s.catOut) ? s.catOut : DEFAULT.catOut,
    descriptions: Array.isArray(s.descriptions) ? s.descriptions : DEFAULT.descriptions,
    budgets: s.budgets && typeof s.budgets === "object" ? s.budgets : {},
  };
}

function catListFor(data, tipe) {
  const list = tipe === "in" ? data.catIn : data.catOut;
  return Array.isArray(list) && list.length ? list : (tipe === "in" ? DEFAULT.catIn : DEFAULT.catOut);
}

class ModalErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error("Modal error:", error); }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-end justify-center" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-t-3xl w-full max-w-md p-5 shadow-2xl">
            <p className="font-semibold text-rose-600 mb-2">Terjadi kesalahan</p>
            <pre className="text-xs text-slate-600 whitespace-pre-wrap overflow-auto max-h-48">{this.state.error?.message || String(this.state.error)}</pre>
            <button type="button" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }} className="mt-4 w-full bg-slate-200 rounded-xl py-3 text-sm font-medium">Tutup</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const JENIS_ASET = ["Tanah", "Rumah", "Mobil", "Motor", "Properti Lain", "Emas/Perhiasan", "Lainnya"];
const ASSET_ICON = { Tanah: MapPin, Rumah: Home, Mobil: Car, Motor: Bike, "Properti Lain": Building2, "Emas/Perhiasan": Gem, Lainnya: Package };

const DEFAULT = {
  pin: "1234",
  transactions: [],
  assets: [],
  openingHutang: 0,
  openingPiutang: 0,
  accounts: [
    { id: uid(), name: "Kas Tunai", grup: "Tunai", saldoAwal: 0 },
    { id: uid(), name: "Bank BCA", grup: "Bank", saldoAwal: 0 },
    { id: uid(), name: "OVO / GoPay", grup: "E-Wallet", saldoAwal: 0 },
  ],
  catIn: ["Gaji", "Bonus", "Penjualan", "Hasil Usaha", "Terima Piutang", "Terima Hutang", "Lainnya"],
  catOut: ["Makan & Minum", "Transportasi", "Tagihan", "Belanja", "Hiburan", "Kesehatan", "Pendidikan", "Bayar Hutang", "Beri Piutang", "Lainnya"],
  descriptions: ["Gaji bulanan", "Belanja harian", "Bayar listrik", "Isi bensin", "Makan siang", "Beri pinjaman", "Bayar cicilan"],
  budgets: {},
};

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

function compressImage(file, maxDim = 900, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = (height * maxDim) / width; width = maxDim; }
        else if (height > maxDim) { width = (width * maxDim) / height; height = maxDim; }
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const { t, fmtDate } = useI18n();
  const [data, setData] = useState(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState("home");
  const [isAdmin, setIsAdmin] = useState(false);
  const [month, setMonth] = useState(curMonth());
  const [search, setSearch] = useState("");
  const [pinModal, setPinModal] = useState(null);
  const [txModal, setTxModal] = useState(null);
  const [assetModal, setAssetModal] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [photoView, setPhotoView] = useState(null);
  const [toast, setToast] = useState("");

  // ✅ Pantau sesi login Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ✅ Load data milik user saat login; reset saat logout
  useEffect(() => {
    if (!session) { setData(DEFAULT); setLoaded(false); setIsAdmin(false); setTab("home"); return; }
    let active = true;
    (async () => {
      try {
        const { settings, transactions, assets } = await loadAll();
        if (active) setData(mergeLoadedData(settings, transactions, assets));
      } catch (e) {
        console.error("Gagal memuat data dari Supabase:", e);
        if (active) flash(t("loadFailed"));
      }
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, [session]);

  // ✅ Simpan konfigurasi (pin, akun, kategori, dll) ke Supabase (debounced)
  useEffect(() => {
    if (!loaded || !session) return;
    const timerId = setTimeout(() => {
      saveSettings(data).catch((e) => console.error("Gagal menyimpan pengaturan:", e));
    }, 600);
    return () => clearTimeout(timerId);
  }, [data, loaded, session]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const logout = async () => { await supabase.auth.signOut(); };
  const requireAdmin = (fn) => { if (isAdmin) return fn(); setPinModal({ onSuccess: fn }); };

  const openingCash = useMemo(() => data.accounts.reduce((a, acc) => a + (acc.saldoAwal || 0), 0), [data.accounts]);
  const totalIn = useMemo(() => data.transactions.filter(row => row.tipe === "in").reduce((a, row) => a + row.jumlah, 0), [data.transactions]);
  const totalOut = useMemo(() => data.transactions.filter(row => row.tipe === "out").reduce((a, row) => a + row.jumlah, 0), [data.transactions]);
  const saldo = openingCash + totalIn - totalOut;

  const monthTx = useMemo(() => data.transactions.filter(row => row.tanggal.slice(0, 7) === month), [data.transactions, month]);
  const monthIn = monthTx.filter(row => row.tipe === "in").reduce((a, row) => a + row.jumlah, 0);
  const monthOut = monthTx.filter(row => row.tipe === "out").reduce((a, row) => a + row.jumlah, 0);

  const hutang = useMemo(() => {
    const terima = data.transactions.filter(row => row.kategori === "Terima Hutang").reduce((a, row) => a + row.jumlah, 0);
    const bayar = data.transactions.filter(row => row.kategori === "Bayar Hutang").reduce((a, row) => a + row.jumlah, 0);
    return (data.openingHutang || 0) + terima - bayar;
  }, [data.transactions, data.openingHutang]);

  const piutang = useMemo(() => {
    const beri = data.transactions.filter(row => row.kategori === "Beri Piutang").reduce((a, row) => a + row.jumlah, 0);
    const terima = data.transactions.filter(row => row.kategori === "Terima Piutang").reduce((a, row) => a + row.jumlah, 0);
    return (data.openingPiutang || 0) + beri - terima;
  }, [data.transactions, data.openingPiutang]);

  const totalAset = useMemo(() => data.assets.reduce((a, x) => a + (x.nilai || 0), 0), [data.assets]);
  const netWorth = saldo + totalAset + piutang - hutang;

  const saveTx = async (tx, file, removePhoto) => {
    let hasPhoto = tx.hasPhoto;
    try {
      if (file) { const d = await compressImage(file); await savePhoto(tx.id, d); hasPhoto = true; }
      if (removePhoto) { await delPhoto(tx.id); hasPhoto = false; }
      const next = { ...tx, hasPhoto };
      await upsertTransaction(next);
      setData(p => {
        const exists = p.transactions.some(t => t.id === tx.id);
        const transactions = exists ? p.transactions.map(t => t.id === tx.id ? next : t) : [next, ...p.transactions];
        const descriptions = tx.keterangan && !p.descriptions.includes(tx.keterangan) ? [tx.keterangan, ...p.descriptions] : p.descriptions;
        return { ...p, transactions, descriptions };
      });
      setTxModal(null);
      flash(tx._edit ? t("txUpdated") : t("txAdded"));
    } catch (e) {
      console.error(e);
      flash(t("txSaveFailed"));
    }
  };

  const deleteTx = (id, hasPhoto) => requireAdmin(async () => {
    try {
      if (hasPhoto) await delPhoto(id);
      await dbDeleteTx(id);
      setData(p => ({ ...p, transactions: p.transactions.filter(row => row.id !== id) }));
      flash(t("txDeleted"));
    } catch (e) {
      console.error(e);
      flash(t("txDeleteFailed"));
    }
  });

  const saveAsset = async (asset, file, removePhoto) => {
    let hasPhoto = asset.hasPhoto;
    try {
      if (file) { const d = await compressImage(file); await savePhoto(asset.id, d); hasPhoto = true; }
      if (removePhoto) { await delPhoto(asset.id); hasPhoto = false; }
      const next = { ...asset, hasPhoto };
      await upsertAsset(next);
      setData(p => {
        const exists = p.assets.some(a => a.id === asset.id);
        const assets = exists ? p.assets.map(a => a.id === asset.id ? next : a) : [next, ...p.assets];
        return { ...p, assets };
      });
      setAssetModal(null);
      flash(asset._edit ? t("assetUpdated") : t("assetAdded"));
    } catch (e) {
      console.error(e);
      flash(t("assetSaveFailed"));
    }
  };

  const deleteAsset = (id, hasPhoto) => requireAdmin(async () => {
    try {
      if (hasPhoto) await delPhoto(id);
      await dbDeleteAsset(id);
      setData(p => ({ ...p, assets: p.assets.filter(a => a.id !== id) }));
      flash(t("assetDeleted"));
    } catch (e) {
      console.error(e);
      flash(t("assetDeleteFailed"));
    }
  });

  if (!authReady) return <div className="flex items-center justify-center h-96 text-slate-400">{t("loading")}</div>;
  if (!session) return <AuthScreen />;
  if (!loaded) return <div className="flex items-center justify-center h-96 text-slate-400">{t("loading")}</div>;

  return (
    <div className="max-w-md mx-auto bg-slate-50 min-h-screen text-slate-800 pb-24 select-none">
      <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white px-5 pt-6 pb-8 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2"><Wallet size={22} /><span className="font-semibold tracking-tight">{t("appTitle")}</span></div>
          <div className="flex items-center gap-2">
            <button onClick={() => isAdmin ? setIsAdmin(false) : setPinModal({ onSuccess: () => {} })} className="flex items-center gap-1.5 text-xs bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-full transition">
              {isAdmin ? <Unlock size={14} /> : <Lock size={14} />}{isAdmin ? t("admin") : t("locked")}
            </button>
            <button onClick={logout} title={t("logout")} className="flex items-center text-xs bg-white/15 hover:bg-white/25 p-1.5 rounded-full transition"><LogOut size={14} /></button>
          </div>
        </div>
        <div className="text-emerald-100 text-xs mb-1">{t("totalBalance")}</div>
        <div className="text-3xl font-bold tracking-tight">{rupiah(saldo)}</div>
        <div className="flex gap-3 mt-4">
          <div className="flex-1 bg-white/10 rounded-xl px-3 py-2"><div className="flex items-center gap-1 text-emerald-100 text-[11px]"><TrendingUp size={12} />{t("income")}</div><div className="font-semibold text-sm mt-0.5">{rupiah(totalIn)}</div></div>
          <div className="flex-1 bg-white/10 rounded-xl px-3 py-2"><div className="flex items-center gap-1 text-rose-100 text-[11px]"><TrendingDown size={12} />{t("expense")}</div><div className="font-semibold text-sm mt-0.5">{rupiah(totalOut)}</div></div>
        </div>
      </div>

      <div className="px-4 -mt-4">
        {tab === "home" && <HomeTab {...{ data, month, setMonth, monthIn, monthOut, monthTx, saldo, totalAset, hutang, piutang, netWorth, setTab }} />}
        {tab === "tx" && <TxTab {...{ data, month, setMonth, search, setSearch, isAdmin, requireAdmin, setTxModal, deleteTx, setPhotoView }} />}
        {tab === "asset" && <AssetTab {...{ data, isAdmin, requireAdmin, setAssetModal, deleteAsset, setPhotoView }} />}
        {tab === "report" && <ReportTab {...{ data, month, setMonth, monthTx, hutang, piutang }} />}
        {tab === "settings" && <SettingsTab {...{ data, setData, isAdmin, requireAdmin, flash, userEmail: session?.user?.email, onLogout: logout }} />}
      </div>

      {(tab === "home" || tab === "tx") && (
        <>
          <button onClick={() => requireAdmin(() => setScanOpen(true))} className="fixed bottom-40 bg-white border border-emerald-200 text-emerald-600 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition active:scale-95" style={{ right: "max(1rem, calc(50% - 14rem))" }}><Sparkles size={22} /></button>
          <button onClick={() => requireAdmin(() => setTxModal({ editing: null }))} className="fixed bottom-24 bg-emerald-600 hover:bg-emerald-700 text-white w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition active:scale-95" style={{ right: "max(1rem, calc(50% - 14rem))" }}><Plus size={26} /></button>
        </>
      )}

      <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-white border-t border-slate-200 grid grid-cols-5 px-1 py-2">
        {[
          { k: "home", icon: Home, label: t("navHome") },
          { k: "tx", icon: List, label: t("navTx") },
          { k: "asset", icon: Building2, label: t("navAsset") },
          { k: "report", icon: BarChart3, label: t("navReport") },
          { k: "settings", icon: SettingsIcon, label: t("navSettings") },
        ].map(({ k, icon: Icon, label }) => (
          <button key={k} onClick={() => setTab(k)} className={"flex flex-col items-center gap-0.5 py-1 rounded-lg text-[10px] transition " + (tab === k ? "text-emerald-600" : "text-slate-400")}>
            <Icon size={19} />{label}
          </button>
        ))}
      </div>

      {pinModal && <PinModal correctPin={data.pin} onClose={() => setPinModal(null)} onSuccess={() => { setIsAdmin(true); const fn = pinModal.onSuccess; setPinModal(null); fn && fn(); }} />}
      {txModal && (
        <ModalErrorBoundary onReset={() => setTxModal(null)}>
          <TxModal data={data} editing={txModal.editing} prefill={txModal.prefill} prefillFile={txModal.prefillFile} onClose={() => setTxModal(null)} onSave={saveTx} />
        </ModalErrorBoundary>
      )}
      {assetModal && (
        <ModalErrorBoundary onReset={() => setAssetModal(null)}>
          <AssetModal editing={assetModal.editing} onClose={() => setAssetModal(null)} onSave={saveAsset} />
        </ModalErrorBoundary>
      )}
      {scanOpen && <ScanModal data={data} onClose={() => setScanOpen(false)} onConfirm={(prefill, file) => { setScanOpen(false); setTxModal({ editing: null, prefill, prefillFile: file }); }} />}
      {photoView && <PhotoModal src={photoView.src} onClose={() => setPhotoView(null)} />}
      {toast && <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50">{toast}</div>}
    </div>
  );
}

function AuthScreen() {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const hashErr = consumeAuthHashError();
    if (hashErr === "otp_expired") setErr(t("emailLinkExpired"));
    else if (hashErr) setErr(hashErr);
  }, [t]);

  const submit = async (e) => {
    e?.preventDefault();
    setErr(""); setMsg("");
    const mail = email.trim();
    if (!mail || !password) { setErr(t("emailPasswordRequired")); return; }
    if (password.length < 6) { setErr(t("passwordMin6")); return; }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: mail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setMsg(t("accountCreated"));
      }
    } catch (e2) {
      setErr(e2?.message || t("errorGeneric"));
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="text-center text-white mb-6">
          <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center mx-auto mb-3"><Wallet size={28} /></div>
          <div className="text-xl font-bold tracking-tight">{t("appTitle")}</div>
          <div className="text-emerald-100 text-sm mt-1">{mode === "login" ? t("loginToAccount") : t("createAccount")}</div>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-5 space-y-3">
          <div>
            <div className="text-xs text-slate-500 mb-1 font-medium">{t("email")}</div>
            <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3">
              <Mail size={16} className="text-slate-400" />
              <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@email.com" className="flex-1 py-2.5 text-sm outline-none" />
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1 font-medium">{t("password")}</div>
            <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3">
              <KeyRound size={16} className="text-slate-400" />
              <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={t("passwordPlaceholder")} className="flex-1 py-2.5 text-sm outline-none" />
            </div>
          </div>
          {err && <div className="text-rose-500 text-xs">{err}</div>}
          {msg && <div className="text-emerald-600 text-xs">{msg}</div>}
          <button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl py-3 font-medium transition">
            {busy ? t("processing") : mode === "login" ? t("login") : t("signup")}
          </button>
        </form>
        <div className="text-center text-emerald-50 text-sm mt-4">
          {mode === "login" ? t("noAccount") + " " : t("hasAccount") + " "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); setMsg(""); }} className="font-semibold underline">
            {mode === "login" ? t("signup") : t("login")}
          </button>
        </div>
        <div className="flex justify-center gap-2 mt-5">
          <button onClick={() => setLang("id")} className={"text-xs px-3 py-1.5 rounded-full transition " + (lang === "id" ? "bg-white/25 text-white font-medium" : "text-emerald-100/80")}>{t("langId")}</button>
          <button onClick={() => setLang("en")} className={"text-xs px-3 py-1.5 rounded-full transition " + (lang === "en" ? "bg-white/25 text-white font-medium" : "text-emerald-100/80")}>{t("langEn")}</button>
        </div>
      </div>
    </div>
  );
}

function HomeTab({ data, month, setMonth, monthIn, monthOut, monthTx, saldo, totalAset, hutang, piutang, netWorth, setTab }) {
  const { t, label, fmtDate } = useI18n();
  const recent = [...data.transactions].sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.createdAt - a.createdAt).slice(0, 5);
  const accBal = (acc) => (acc.saldoAwal || 0) + data.transactions.filter(row => row.akun === acc.name).reduce((s, row) => s + (row.tipe === "in" ? row.jumlah : -row.jumlah), 0);
  const budgetRows = data.catOut.map(cat => {
    const b = data.budgets[cat] || 0;
    if (!b) return null;
    const spent = monthTx.filter(row => row.tipe === "out" && row.kategori === cat).reduce((a, row) => a + row.jumlah, 0);
    return { cat, b, spent, pct: Math.min(100, Math.round((spent / b) * 100)) };
  }).filter(Boolean);

  return (
    <div className="space-y-4 pt-2">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1"><Gem size={14} className="text-emerald-600" />{t("netWorth")}</div>
        <div className="text-2xl font-bold text-slate-800">{rupiah(netWorth)}</div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div className="flex justify-between bg-slate-50 rounded-lg px-2.5 py-1.5"><span className="text-slate-500">{t("cashBank")}</span><span className="font-medium">{rupiah(saldo)}</span></div>
          <div className="flex justify-between bg-slate-50 rounded-lg px-2.5 py-1.5"><span className="text-slate-500">{t("assets")}</span><span className="font-medium">{rupiah(totalAset)}</span></div>
          <div className="flex justify-between bg-blue-50 rounded-lg px-2.5 py-1.5"><span className="text-blue-600">+ {t("receivable")}</span><span className="font-medium text-blue-700">{rupiah(piutang)}</span></div>
          <div className="flex justify-between bg-amber-50 rounded-lg px-2.5 py-1.5"><span className="text-amber-600">− {t("debt")}</span><span className="font-medium text-amber-700">{rupiah(hutang)}</span></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-1.5 font-semibold text-sm mb-3"><Coins size={16} className="text-emerald-600" />{t("balancePerAccount")}</div>
        <div className="space-y-2.5">
          {data.accounts.map(a => (
            <div key={a.id} className="flex items-center justify-between">
              <div><div className="text-sm font-medium">{label(a.name)}</div><div className="text-[11px] text-slate-400">{label(a.grup)}</div></div>
              <div className="text-sm font-semibold">{rupiah(accBal(a))}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-sm">{t("monthSummary")}</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 bg-emerald-50 rounded-xl p-3"><div className="text-emerald-600 text-[11px] font-medium">{t("in")}</div><div className="font-bold text-emerald-700 text-sm mt-1">{rupiah(monthIn)}</div></div>
          <div className="flex-1 bg-rose-50 rounded-xl p-3"><div className="text-rose-600 text-[11px] font-medium">{t("out")}</div><div className="font-bold text-rose-700 text-sm mt-1">{rupiah(monthOut)}</div></div>
          <div className="flex-1 bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-[11px] font-medium">{t("difference")}</div><div className={"font-bold text-sm mt-1 " + (monthIn - monthOut >= 0 ? "text-slate-700" : "text-rose-600")}>{rupiah(monthIn - monthOut)}</div></div>
        </div>
      </div>

      {budgetRows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center gap-1.5 font-semibold text-sm mb-3"><Target size={16} className="text-emerald-600" />{t("monthlyTarget")}</div>
          <div className="space-y-3">
            {budgetRows.map(r => (
              <div key={r.cat}>
                <div className="flex justify-between text-xs mb-1"><span className="text-slate-600">{label(r.cat)}</span><span className={r.pct >= 100 ? "text-rose-600 font-medium" : "text-slate-500"}>{rupiah(r.spent)} / {rupiah(r.b)}</span></div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={"h-full rounded-full " + (r.pct >= 100 ? "bg-rose-500" : r.pct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: r.pct + "%" }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-sm">{t("recentTransactions")}</span>
          <button onClick={() => setTab("tx")} className="text-xs text-emerald-600 flex items-center">{t("all")} <ChevronRight size={14} /></button>
        </div>
        {recent.length === 0 ? <div className="text-center text-slate-400 text-sm py-6">{t("noTransactionsYet")}</div> : <div className="space-y-2">{recent.map(tx => <TxRow key={tx.id} t={tx} fmtDate={fmtDate} />)}</div>}
      </div>
    </div>
  );
}

function TxRow({ t: tx, onClick, fmtDate }) {
  const { label } = useI18n();
  return (
    <div onClick={onClick} className={"flex items-center gap-3 py-2 " + (onClick ? "cursor-pointer active:bg-slate-50 rounded-lg" : "")}>
      <div className={"w-9 h-9 rounded-full flex items-center justify-center shrink-0 " + (tx.tipe === "in" ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{tx.tipe === "in" ? <TrendingUp size={16} /> : <TrendingDown size={16} />}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{label(tx.kategori)}</div>
        <div className="text-[11px] text-slate-400 truncate">{fmtDate(tx.tanggal)}{tx.keterangan ? " · " + tx.keterangan : ""}{tx.akun ? " · " + label(tx.akun) : ""}</div>
      </div>
      {tx.hasPhoto && <Camera size={13} className="text-slate-300 shrink-0" />}
      <div className={"text-sm font-semibold shrink-0 " + (tx.tipe === "in" ? "text-emerald-600" : "text-rose-600")}>{tx.tipe === "in" ? "+" : "-"}{rupiah(tx.jumlah)}</div>
    </div>
  );
}

function TxTab({ data, month, setMonth, search, setSearch, isAdmin, requireAdmin, setTxModal, deleteTx, setPhotoView }) {
  const { t, fmtDate } = useI18n();
  const list = useMemo(() => data.transactions
    .filter(row => row.tanggal.slice(0, 7) === month)
    .filter(row => !search || (row.kategori + " " + (row.keterangan || "") + " " + (row.akun || "")).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.createdAt - a.createdAt), [data.transactions, month, search]);
  const openPhoto = async (id) => { const src = await loadPhoto(id); if (src) setPhotoView({ src }); };

  return (
    <div className="space-y-3 pt-2">
      <div className="bg-white rounded-2xl shadow-sm p-3 flex gap-2 items-center">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-2" />
        <div className="flex-1 flex items-center gap-1.5 bg-slate-50 rounded-lg px-2"><Search size={15} className="text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("search")} className="flex-1 bg-transparent text-sm py-2 outline-none" /></div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        {list.length === 0 ? <div className="text-center text-slate-400 text-sm py-10">{t("noTransactionsThisMonth")}</div> : (
          <div className="divide-y divide-slate-100">
            {list.map(tx => (
              <div key={tx.id} className="flex items-center gap-2">
                <div className="flex-1" onClick={() => tx.hasPhoto && openPhoto(tx.id)}><TxRow t={tx} fmtDate={fmtDate} /></div>
                {isAdmin && <div className="flex gap-1 shrink-0"><button onClick={() => setTxModal({ editing: tx })} className="p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={15} /></button><button onClick={() => deleteTx(tx.id, tx.hasPhoto)} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button></div>}
              </div>
            ))}
          </div>
        )}
      </div>
      {!isAdmin && <div className="text-center text-[11px] text-slate-400">{t("adminRequiredTx")}</div>}
    </div>
  );
}

function AssetTab({ data, isAdmin, requireAdmin, setAssetModal, deleteAsset, setPhotoView }) {
  const { t, label, fmtDate } = useI18n();
  const total = data.assets.reduce((a, x) => a + (x.nilai || 0), 0);
  const openPhoto = async (id) => { const src = await loadPhoto(id); if (src) setPhotoView({ src }); };
  return (
    <div className="space-y-3 pt-2">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-slate-500 text-xs">{t("totalAssetValue")}</div>
        <div className="text-2xl font-bold text-slate-800 mt-1">{rupiah(total)}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">{data.assets.length} {t("assetsRecorded")}</div>
      </div>
      <button onClick={() => requireAdmin(() => setAssetModal({ editing: null }))} className="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2"><Plus size={16} />{t("addAsset")}</button>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        {data.assets.length === 0 ? <div className="text-center text-slate-400 text-sm py-10">{t("noAssetsYet")}</div> : (
          <div className="divide-y divide-slate-100">
            {data.assets.map(a => {
              const Icon = ASSET_ICON[a.jenis] || Package;
              return (
                <div key={a.id} className="flex items-center gap-3 py-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0" onClick={() => a.hasPhoto && openPhoto(a.id)}><Icon size={18} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.nama}</div>
                    <div className="text-[11px] text-slate-400 truncate">{label(a.jenis)}{a.tanggal ? " · " + fmtDate(a.tanggal) : ""}{a.keterangan ? " · " + a.keterangan : ""}</div>
                  </div>
                  {a.hasPhoto && <Camera size={13} className="text-slate-300 shrink-0" />}
                  <div className="text-sm font-semibold text-slate-700 shrink-0">{rupiah(a.nilai)}</div>
                  {isAdmin && <div className="flex flex-col gap-0.5 shrink-0"><button onClick={() => setAssetModal({ editing: a })} className="p-1 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => deleteAsset(a.id, a.hasPhoto)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!isAdmin && <div className="text-center text-[11px] text-slate-400">{t("adminRequiredAsset")}</div>}
    </div>
  );
}

function ReportTab({ data, month, setMonth, monthTx, hutang, piutang }) {
  const { t, label, locale } = useI18n();
  const byCat = useMemo(() => {
    const m = {};
    monthTx.filter(row => row.tipe === "out").forEach(row => { m[row.kategori] = (m[row.kategori] || 0) + row.jumlah; });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [monthTx]);

  const last6 = useMemo(() => {
    const arr = [];
    const base = new Date(month + "-01T00:00:00");
    const inKey = t("chartIn");
    const outKey = t("chartOut");
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const ym = d.toISOString().slice(0, 7);
      const txList = data.transactions.filter(row => row.tanggal.slice(0, 7) === ym);
      arr.push({ bulan: d.toLocaleDateString(locale, { month: "short" }), [inKey]: txList.filter(row => row.tipe === "in").reduce((a, row) => a + row.jumlah, 0), [outKey]: txList.filter(row => row.tipe === "out").reduce((a, row) => a + row.jumlah, 0) });
    }
    return arr;
  }, [data.transactions, month, locale, t]);

  const totalOut = byCat.reduce((a, c) => a + c.value, 0);

  return (
    <div className="space-y-4 pt-2">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-sm">{t("expenseByCategory")}</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1" />
        </div>
        {byCat.length === 0 ? <div className="text-center text-slate-400 text-sm py-8">{t("noExpensesYet")}</div> : (
          <>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={byCat} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={42}>{byCat.map((e, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip formatter={(v) => rupiah(v)} /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 mt-2">
              {byCat.map((c, i) => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="flex-1 text-slate-600">{label(c.name)}</span>
                  <span className="text-slate-400">{Math.round((c.value / totalOut) * 100)}%</span>
                  <span className="font-medium text-slate-700">{rupiah(c.value)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="font-semibold text-sm mb-3">{t("sixMonthTrend")}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={last6} margin={{ left: -10 }}>
              <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e6 ? (v / 1e6) + (locale === "en-US" ? "M" : "jt") : v >= 1e3 ? (v / 1e3) + (locale === "en-US" ? "K" : "rb") : v} />
              <Tooltip formatter={(v) => rupiah(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey={t("chartIn")} fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey={t("chartOut")} fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="font-semibold text-sm mb-3">{t("debtReceivable")}</div>
        <div className="flex gap-3">
          <div className="flex-1 bg-amber-50 rounded-xl p-3"><div className="text-amber-600 text-[11px] font-medium">{t("totalDebt")}</div><div className="font-bold text-amber-700 text-sm mt-1">{rupiah(hutang)}</div></div>
          <div className="flex-1 bg-blue-50 rounded-xl p-3"><div className="text-blue-600 text-[11px] font-medium">{t("totalReceivable")}</div><div className="font-bold text-blue-700 text-sm mt-1">{rupiah(piutang)}</div></div>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ data, setData, isAdmin, requireAdmin, flash, userEmail, onLogout }) {
  const { t, label, lang, setLang } = useI18n();
  const [newAcc, setNewAcc] = useState({ name: "", grup: "" });
  const [newCat, setNewCat] = useState({ name: "", tipe: "out" });
  const [newDesc, setNewDesc] = useState("");
  const [pinEdit, setPinEdit] = useState({ open: false, val: "" });
  const [openingOpen, setOpeningOpen] = useState(false);

  const guard = (fn) => () => requireAdmin(fn);
  const addAcc = () => { if (!newAcc.name.trim()) return; setData(p => ({ ...p, accounts: [...p.accounts, { id: uid(), name: newAcc.name.trim(), grup: newAcc.grup.trim() || "Umum", saldoAwal: 0 }] })); setNewAcc({ name: "", grup: "" }); };
  const delAcc = (id) => setData(p => ({ ...p, accounts: p.accounts.filter(a => a.id !== id) }));
  const addCat = () => { if (!newCat.name.trim()) return; const key = newCat.tipe === "in" ? "catIn" : "catOut"; setData(p => ({ ...p, [key]: [...p[key], newCat.name.trim()] })); setNewCat({ name: "", tipe: newCat.tipe }); };
  const delCat = (tipe, name) => { const key = tipe === "in" ? "catIn" : "catOut"; setData(p => ({ ...p, [key]: p[key].filter(c => c !== name) })); };
  const addDesc = () => { if (!newDesc.trim() || data.descriptions.includes(newDesc.trim())) return; setData(p => ({ ...p, descriptions: [newDesc.trim(), ...p.descriptions] })); setNewDesc(""); };
  const delDesc = (d) => setData(p => ({ ...p, descriptions: p.descriptions.filter(x => x !== d) }));
  const setBudget = (cat, val) => setData(p => ({ ...p, budgets: { ...p.budgets, [cat]: parseNum(val) } }));
  const saveOpening = (accVals, hutang, piutang) => {
    setData(p => ({ ...p, accounts: p.accounts.map(a => ({ ...a, saldoAwal: accVals[a.id] ?? (a.saldoAwal || 0) })), openingHutang: hutang, openingPiutang: piutang }));
    setOpeningOpen(false); flash(t("openingSaved"));
  };

  return (
    <div className="space-y-4 pt-2">
      <Section icon={Languages} title={t("language")} sub={t("languageSub")}>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setLang("id")} className={"py-2.5 rounded-xl text-sm font-medium transition " + (lang === "id" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")}>{t("langId")}</button>
          <button onClick={() => setLang("en")} className={"py-2.5 rounded-xl text-sm font-medium transition " + (lang === "en" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")}>{t("langEn")}</button>
        </div>
      </Section>
      <Section icon={Mail} title={t("accountSection")} sub={t("accountSub")}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{userEmail || "—"}</div>
            <div className="text-[11px] text-slate-400">{t("syncedDevices")}</div>
          </div>
          <button onClick={onLogout} className="flex items-center gap-1.5 text-sm text-rose-600 font-medium shrink-0"><LogOut size={15} />{t("logout")}</button>
        </div>
      </Section>
      {!isAdmin && <button onClick={() => requireAdmin(() => flash(t("adminModeActive")))} className="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2"><Lock size={16} />{t("openAdminMode")}</button>}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <button onClick={() => requireAdmin(() => setOpeningOpen(true))} className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-xl py-3 text-sm font-medium"><WalletIcon size={16} />{t("setOpeningBalance")}</button>
        <div className="text-[11px] text-slate-400 text-center mt-2">{t("openingBalanceHint")}</div>
      </div>
      <Section icon={Target} title={t("monthlyBudget")} sub={t("budgetSub")}>
        <div className="space-y-2">
          {data.catOut.map(cat => (
            <div key={cat} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-slate-600">{label(cat)}</span>
              <div className="flex items-center gap-1 bg-slate-50 rounded-lg px-2"><span className="text-xs text-slate-400">Rp</span><input disabled={!isAdmin} value={fmtThousand(data.budgets[cat] || 0)} onChange={e => setBudget(cat, e.target.value)} placeholder="0" inputMode="numeric" className="w-24 bg-transparent text-sm py-1.5 text-right outline-none disabled:opacity-60" /></div>
            </div>
          ))}
        </div>
      </Section>
      <Section icon={CreditCard} title={t("accountsWallets")} sub={t("accountsSub")}>
        <div className="space-y-2 mb-3">
          {data.accounts.map(a => (
            <div key={a.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <div className="flex-1"><div className="text-sm font-medium">{label(a.name)}</div><div className="text-[11px] text-slate-400">{label(a.grup)} · {t("opening")} {rupiah(a.saldoAwal || 0)}</div></div>
              {isAdmin && <button onClick={guard(() => delAcc(a.id))} className="text-slate-300 hover:text-rose-500"><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
        {isAdmin && <div className="flex gap-2"><input value={newAcc.name} onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} placeholder={t("accountName")} className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" /><input value={newAcc.grup} onChange={e => setNewAcc({ ...newAcc, grup: e.target.value })} placeholder={t("group")} className="w-20 border border-slate-200 rounded-lg px-2 py-2 text-sm" /><button onClick={addAcc} className="bg-emerald-600 text-white rounded-lg px-3"><Plus size={16} /></button></div>}
      </Section>
      <Section icon={Tag} title={t("categories")}>
        <div className="text-[11px] text-emerald-600 font-medium mb-1">{t("incomeCategories")}</div>
        <div className="flex flex-wrap gap-1.5 mb-3">{data.catIn.map(c => <Chip key={c} label={label(c)} onDel={isAdmin ? guard(() => delCat("in", c)) : null} />)}</div>
        <div className="text-[11px] text-rose-600 font-medium mb-1">{t("expenseCategories")}</div>
        <div className="flex flex-wrap gap-1.5 mb-3">{data.catOut.map(c => <Chip key={c} label={label(c)} onDel={isAdmin ? guard(() => delCat("out", c)) : null} />)}</div>
        {isAdmin && <div className="flex gap-2"><select value={newCat.tipe} onChange={e => setNewCat({ ...newCat, tipe: e.target.value })} className="border border-slate-200 rounded-lg px-2 text-sm"><option value="out">{t("out")}</option><option value="in">{t("in")}</option></select><input value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder={t("newCategory")} className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" /><button onClick={addCat} className="bg-emerald-600 text-white rounded-lg px-3"><Plus size={16} /></button></div>}
      </Section>
      <Section icon={List} title={t("savedDescriptions")} sub={t("savedDescSub")}>
        <div className="flex flex-wrap gap-1.5 mb-3">{data.descriptions.map(d => <Chip key={d} label={d} onDel={isAdmin ? guard(() => delDesc(d)) : null} />)}</div>
        {isAdmin && <div className="flex gap-2"><input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder={t("newDescription")} className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" /><button onClick={addDesc} className="bg-emerald-600 text-white rounded-lg px-3"><Plus size={16} /></button></div>}
      </Section>
      <Section icon={Lock} title={t("adminPin")}>
        {!pinEdit.open ? <button onClick={() => requireAdmin(() => setPinEdit({ open: true, val: "" }))} className="text-sm text-emerald-600 font-medium">{t("changePin")}</button> : (
          <div className="flex gap-2"><input value={pinEdit.val} onChange={e => setPinEdit({ ...pinEdit, val: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={t("newPin")} inputMode="numeric" className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" /><button onClick={() => { if (pinEdit.val.length >= 4) { setData(p => ({ ...p, pin: pinEdit.val })); setPinEdit({ open: false, val: "" }); flash(t("pinUpdated")); } else flash(t("pinMin4")); }} className="bg-emerald-600 text-white rounded-lg px-3 flex items-center"><Save size={16} /></button></div>
        )}
        <div className="text-[11px] text-slate-400 mt-2">{t("defaultPin")}</div>
      </Section>
      <div className="text-center text-[11px] text-slate-300 pb-2">{t("autoSaveNote")}</div>
      {openingOpen && <OpeningBalanceModal data={data} onClose={() => setOpeningOpen(false)} onSave={saveOpening} />}
    </div>
  );
}

function OpeningBalanceModal({ data, onClose, onSave }) {
  const { t, label } = useI18n();
  const [accVals, setAccVals] = useState(() => Object.fromEntries(data.accounts.map(a => [a.id, a.saldoAwal || 0])));
  const [hutang, setHutang] = useState(data.openingHutang || 0);
  const [piutang, setPiutang] = useState(data.openingPiutang || 0);
  return (
    <Overlay onClose={onClose} bottom>
      <div className="flex items-center justify-between mb-4"><span className="font-semibold">{t("setOpeningBalance")}</span><button onClick={onClose} className="text-slate-400"><X size={20} /></button></div>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <div><div className="text-xs font-medium text-slate-500 mb-2">{t("cashBankEwallet")}</div>
          <div className="space-y-2">{data.accounts.map(a => (
            <div key={a.id} className="flex items-center gap-2">
              <div className="flex-1"><div className="text-sm font-medium">{label(a.name)}</div><div className="text-[11px] text-slate-400">{label(a.grup)}</div></div>
              <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2"><span className="text-xs text-slate-400">Rp</span><input inputMode="numeric" value={fmtThousand(accVals[a.id])} onChange={e => setAccVals({ ...accVals, [a.id]: parseNum(e.target.value) })} placeholder="0" className="w-28 text-sm py-2 text-right outline-none" /></div>
            </div>
          ))}</div>
        </div>
        <div><div className="text-xs font-medium text-slate-500 mb-2">{t("debtReceivable")}</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2"><div className="flex-1"><div className="text-sm font-medium text-amber-700">{t("myDebt")}</div><div className="text-[11px] text-slate-400">{t("myDebtSub")}</div></div><div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2"><span className="text-xs text-slate-400">Rp</span><input inputMode="numeric" value={fmtThousand(hutang)} onChange={e => setHutang(parseNum(e.target.value))} placeholder="0" className="w-28 text-sm py-2 text-right outline-none" /></div></div>
            <div className="flex items-center gap-2"><div className="flex-1"><div className="text-sm font-medium text-blue-700">{t("myReceivable")}</div><div className="text-[11px] text-slate-400">{t("myReceivableSub")}</div></div><div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2"><span className="text-xs text-slate-400">Rp</span><input inputMode="numeric" value={fmtThousand(piutang)} onChange={e => setPiutang(parseNum(e.target.value))} placeholder="0" className="w-28 text-sm py-2 text-right outline-none" /></div></div>
          </div>
        </div>
      </div>
      <button onClick={() => onSave(accVals, hutang, piutang)} className="w-full bg-emerald-600 text-white rounded-xl py-3 font-medium mt-4">{t("saveOpeningBalance")}</button>
    </Overlay>
  );
}

function ScanModal({ data, onClose, onConfirm }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState("idle");
  const [errMsg, setErrMsg] = useState("");
  const [preview, setPreview] = useState(null);
  const fileRef = useRef();

  const handlePick = async (file) => {
    if (!file) return;
    setPhase("reading");
    try {
      const dataUrl = await compressImage(file, 1400, 0.75);
      setPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      // ✅ Panggil /api/scan (bukan langsung ke Anthropic)
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, categories: data.catOut }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("scanFailed"));
      const parsed = json.data;
      if (!parsed) throw new Error(t("scanUnreadable"));
      if (parsed.error) throw new Error(t("scanNotReadable"));
      const total = parseNum(parsed.total);
      if (!total) throw new Error(t("scanNoTotal"));
      const validTgl = typeof parsed.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.tanggal) ? parsed.tanggal : todayStr();
      const kategori = data.catOut.includes(parsed.kategori) ? parsed.kategori : "Lainnya";
      const keterangan = (parsed.keterangan || parsed.merchant || "").toString().slice(0, 80);
      onConfirm({ tipe: "out", tanggal: validTgl, kategori, keterangan, jumlah: total }, file);
    } catch (e) {
      setErrMsg(e.message || t("scanFailed")); setPhase("error");
    }
  };

  return (
    <Overlay onClose={onClose} bottom>
      <div className="flex items-center justify-between mb-4"><span className="font-semibold flex items-center gap-1.5"><Sparkles size={18} className="text-emerald-600" />{t("scanReceipt")}</span><button onClick={onClose} className="text-slate-400"><X size={20} /></button></div>
      {phase === "idle" && (
        <div className="text-center">
          <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-slate-200 rounded-xl py-10 flex flex-col items-center gap-2 text-slate-400"><Camera size={30} /><span className="text-sm">{t("photoReceipt")}</span></button>
          <div className="text-[11px] text-slate-400 mt-3">{t("scanHint")}</div>
        </div>
      )}
      {phase === "reading" && (
        <div className="text-center py-4">
          {preview && <img src={preview} alt="struk" className="w-28 h-36 object-cover rounded-xl mx-auto mb-4 opacity-70" />}
          <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm"><Sparkles size={16} className="animate-pulse" />{t("readingReceipt")}</div>
        </div>
      )}
      {phase === "error" && (
        <div className="text-center py-6">
          <div className="text-rose-500 text-sm font-medium mb-3 px-4">{errMsg}</div>
          <button onClick={() => { setPhase("idle"); setPreview(null); }} className="text-emerald-600 text-sm font-medium">{t("tryAgain")}</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handlePick(e.target.files?.[0])} />
    </Overlay>
  );
}

function Section({ icon: Icon, title, sub, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3"><Icon size={16} className="text-emerald-600" /><div><div className="font-semibold text-sm">{title}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div></div>
      {children}
    </div>
  );
}

function Chip({ label, onDel }) {
  return <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full">{label}{onDel && <button onClick={onDel} className="text-slate-400 hover:text-rose-500"><X size={12} /></button>}</span>;
}

function PinModal({ correctPin, onClose, onSuccess }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => { if (pin === correctPin) onSuccess(); else { setErr(true); setPin(""); } };
  return (
    <Overlay onClose={onClose}>
      <div className="text-center">
        <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><Lock size={22} className="text-emerald-600" /></div>
        <div className="font-semibold mb-1">{t("enterAdminPin")}</div>
        <div className="text-xs text-slate-400 mb-4">{t("defaultPin")}</div>
        <input autoFocus type="password" inputMode="numeric" value={pin} onChange={e => { setErr(false); setPin(e.target.value.replace(/\D/g, "").slice(0, 6)); }} onKeyDown={e => e.key === "Enter" && submit()} className={"w-full text-center text-2xl tracking-widest border rounded-xl py-3 mb-3 outline-none " + (err ? "border-rose-400" : "border-slate-200")} placeholder="••••" />
        {err && <div className="text-rose-500 text-xs mb-3">{t("wrongPin")}</div>}
        <button onClick={submit} className="w-full bg-emerald-600 text-white rounded-xl py-3 font-medium">{t("open")}</button>
      </div>
    </Overlay>
  );
}

function TxModal({ data, editing, prefill, prefillFile, onClose, onSave }) {
  const { t, label } = useI18n();
  const init = editing || prefill || {};
  const [tipe, setTipe] = useState(init.tipe || "out");
  const initialCats = catListFor(data, init.tipe || "out");
  const [tanggal, setTanggal] = useState(init.tanggal || todayStr());
  const [kategori, setKategori] = useState(
    init.kategori && initialCats.includes(init.kategori) ? init.kategori : (initialCats[0] || "")
  );
  const [akun, setAkun] = useState(init.akun || (data.accounts[0]?.name || ""));
  const [keterangan, setKeterangan] = useState(init.keterangan || "");
  const [jumlah, setJumlah] = useState(init.jumlah || 0);
  const [file, setFile] = useState(prefillFile || null);
  const [filePreview, setFilePreview] = useState(null);
  const [existingPhoto, setExistingPhoto] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  useEffect(() => { if (editing?.hasPhoto) loadPhoto(editing.id).then(setExistingPhoto); }, [editing]);
  useEffect(() => { if (prefillFile) compressImage(prefillFile, 600, 0.5).then(setFilePreview); }, [prefillFile]);
  const cats = catListFor(data, tipe);
  useEffect(() => {
    setKategori(prev => cats.includes(prev) ? prev : (cats[0] || ""));
  }, [tipe, cats]);
  const pickFile = async (f) => { if (!f) return; setFile(f); setRemovePhoto(false); setFilePreview(await compressImage(f, 600, 0.5)); };

  const submit = async () => {
    if (!jumlah || !kategori) return;
    setSaving(true);
    const tx = { id: editing?.id || uid(), tipe, tanggal, kategori, akun, keterangan: keterangan.trim(), jumlah: Number(jumlah), hasPhoto: editing?.hasPhoto || false, createdAt: editing?.createdAt || Date.now(), _edit: !!editing };
    await onSave(tx, file, removePhoto);
  };
  const showImg = filePreview || (existingPhoto && !removePhoto ? existingPhoto : null);

  return (
    <Overlay onClose={onClose} bottom>
      <div className="flex items-center justify-between mb-4"><span className="font-semibold flex items-center gap-1.5">{prefill && <Sparkles size={16} className="text-emerald-600" />}{editing ? t("editTransaction") : prefill ? t("scanResult") : t("addTransaction")}</span><button onClick={onClose} className="text-slate-400"><X size={20} /></button></div>
      {prefill && <div className="bg-emerald-50 text-emerald-700 text-[11px] rounded-lg px-3 py-2 mb-3">{t("scanPrefillNote")}</div>}
      <div className="grid grid-cols-2 gap-2 mb-3 bg-slate-100 p-1 rounded-xl">
        <button onClick={() => setTipe("out")} className={"py-2 rounded-lg text-sm font-medium transition " + (tipe === "out" ? "bg-rose-500 text-white shadow" : "text-slate-500")}>{t("expense")}</button>
        <button onClick={() => setTipe("in")} className={"py-2 rounded-lg text-sm font-medium transition " + (tipe === "in" ? "bg-emerald-500 text-white shadow" : "text-slate-500")}>{t("income")}</button>
      </div>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <Field label={t("amount")}><div className="flex items-center gap-1 border border-slate-200 rounded-xl px-3"><span className="text-slate-400 text-sm">Rp</span><input autoFocus inputMode="numeric" value={fmtThousand(jumlah)} onChange={e => setJumlah(parseNum(e.target.value))} placeholder="0" className="flex-1 py-2.5 text-lg font-semibold outline-none" /></div></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("date")}><input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" /></Field>
          <Field label={t("account")}><select value={akun} onChange={e => setAkun(e.target.value)} className="w-full border border-slate-200 rounded-xl px-2 py-2.5 text-sm">{(data.accounts || []).map(a => <option key={a.id} value={a.name}>{label(a.name)}</option>)}</select></Field>
        </div>
        <Field label={t("category")}><select value={kategori} onChange={e => setKategori(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">{cats.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
        <Field label={t("description")}><input list="desc-list" value={keterangan} onChange={e => setKeterangan(e.target.value)} placeholder={t("descPlaceholder")} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" /><datalist id="desc-list">{(data.descriptions || []).map(d => <option key={d} value={d} />)}</datalist></Field>
        <Field label={t("receiptPhoto")}>
          {showImg ? (
            <div className="relative"><img src={showImg} alt="bukti" className="w-full h-40 object-cover rounded-xl" /><button onClick={() => { setFile(null); setFilePreview(null); setRemovePhoto(true); if (fileRef.current) fileRef.current.value = ""; }} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1"><X size={16} /></button></div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-slate-200 rounded-xl py-6 flex flex-col items-center gap-1 text-slate-400"><Camera size={22} /><span className="text-xs">{t("takePhoto")}</span></button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
        </Field>
      </div>
      <button onClick={submit} disabled={saving || !jumlah} className="w-full bg-emerald-600 disabled:bg-slate-300 text-white rounded-xl py-3 font-medium mt-4">{saving ? t("saving") : t("save")}</button>
    </Overlay>
  );
}

function AssetModal({ editing, onClose, onSave }) {
  const { t, assetTypes } = useI18n();
  const [nama, setNama] = useState(editing?.nama || "");
  const [jenis, setJenis] = useState(editing?.jenis || "Tanah");
  const [nilai, setNilai] = useState(editing?.nilai || 0);
  const [tanggal, setTanggal] = useState(editing?.tanggal || todayStr());
  const [keterangan, setKeterangan] = useState(editing?.keterangan || "");
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [existingPhoto, setExistingPhoto] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  useEffect(() => { if (editing?.hasPhoto) loadPhoto(editing.id).then(setExistingPhoto); }, [editing]);
  const pickFile = async (f) => { if (!f) return; setFile(f); setRemovePhoto(false); setFilePreview(await compressImage(f, 800, 0.55)); };

  const submit = async () => {
    if (!nama.trim() || !nilai) return;
    setSaving(true);
    const asset = { id: editing?.id || uid(), nama: nama.trim(), jenis, nilai: Number(nilai), tanggal, keterangan: keterangan.trim(), hasPhoto: editing?.hasPhoto || false, _edit: !!editing };
    await onSave(asset, file, removePhoto);
  };
  const showImg = filePreview || (existingPhoto && !removePhoto ? existingPhoto : null);

  return (
    <Overlay onClose={onClose} bottom>
      <div className="flex items-center justify-between mb-4"><span className="font-semibold">{editing ? t("editAsset") : t("addAsset")}</span><button onClick={onClose} className="text-slate-400"><X size={20} /></button></div>
      <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
        <Field label={t("assetName")}><input autoFocus value={nama} onChange={e => setNama(e.target.value)} placeholder={t("assetNamePh")} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("type")}><select value={jenis} onChange={e => setJenis(e.target.value)} className="w-full border border-slate-200 rounded-xl px-2 py-2.5 text-sm">{assetTypes.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}</select></Field>
          <Field label={t("acquisitionDate")}><input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" /></Field>
        </div>
        <Field label={t("valueEstimate")}><div className="flex items-center gap-1 border border-slate-200 rounded-xl px-3"><span className="text-slate-400 text-sm">Rp</span><input inputMode="numeric" value={fmtThousand(nilai)} onChange={e => setNilai(parseNum(e.target.value))} placeholder="0" className="flex-1 py-2.5 text-lg font-semibold outline-none" /></div></Field>
        <Field label={t("notesOptional")}><input value={keterangan} onChange={e => setKeterangan(e.target.value)} placeholder={t("notesPh")} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" /></Field>
        <Field label={t("assetPhoto")}>
          {showImg ? (
            <div className="relative"><img src={showImg} alt="aset" className="w-full h-40 object-cover rounded-xl" /><button onClick={() => { setFile(null); setFilePreview(null); setRemovePhoto(true); if (fileRef.current) fileRef.current.value = ""; }} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1"><X size={16} /></button></div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-slate-200 rounded-xl py-6 flex flex-col items-center gap-1 text-slate-400"><Camera size={22} /><span className="text-xs">{t("takePhoto")}</span></button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
        </Field>
      </div>
      <button onClick={submit} disabled={saving || !nilai || !nama.trim()} className="w-full bg-emerald-600 disabled:bg-slate-300 text-white rounded-xl py-3 font-medium mt-4">{saving ? t("saving") : t("save")}</button>
    </Overlay>
  );
}

function PhotoModal({ src, onClose }) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <img src={src} alt="foto" className="max-w-full max-h-full rounded-xl" />
      <button onClick={onClose} className="absolute top-4 right-4 text-white bg-white/20 rounded-full p-2"><X size={20} /></button>
    </div>
  );
}

function Field({ label, children }) {
  return <div><div className="text-xs text-slate-500 mb-1 font-medium">{label}</div>{children}</div>;
}

function Overlay({ children, onClose, bottom }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className={"bg-white w-full max-w-md p-5 shadow-2xl " + (bottom ? "rounded-t-3xl" : "rounded-2xl m-4")}>{children}</div>
    </div>
  );
}