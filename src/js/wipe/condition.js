"use strict";
// 実験条件の決定と被験者ログ。
//
// 配信方法: 静的Webアプリのまま、参加者ごとにURLで条件を割り当てる。
//   ?wipe=avatar  … トゥーン調VRMアバター（カメラで顔追従＋イベント演出）
//   ?wipe=video   … 実際のカメラ映像（従来挙動）
//   ?wipe=none    … ワイプなし（対照条件）
//   ?pid=P001     … 被験者ID（ログに付与）
//   ?avatar=foo   … VRMモデルの差し替え（dist/avatar/foo.vrm を読む。省略時は default）
//   ?log=<url>    … 指定するとイベントを JSON で POST（省略時は localStorage と console のみ）
//
// 例: https://example.com/?pid=P001&wipe=avatar
//     研究者が参加者ごとにこの形のリンクを発行して配布する。

const MODES = ['avatar', 'video', 'none'];

// URLに ?wipe= が無い場合のフォールバック。配信時は必ず明示する想定。
const DEFAULT_MODE = 'video';

function params() {
    try { return new URLSearchParams(window.location.search); }
    catch (e) { return new URLSearchParams(''); }
}

// URLで条件が明示されていれば返す（研究者リンクで条件を固定する用途）。無ければnull。
function urlMode() {
    const m = (params().get('wipe') || '').toLowerCase();
    return MODES.includes(m) ? m : null;
}

// override優先 → URL → 既定。overrideはタイトル画面での選択に使う。
function condition(override) {
    const q = params();
    const mode = (MODES.includes(override) && override) || urlMode() || DEFAULT_MODE;
    return {
        mode,
        pid:    q.get('pid') || 'anon',
        avatar: (q.get('avatar') || 'default').replace(/[^\w-]/g, ''),
        logUrl: q.get('log') || null,
    };
}

// 実験ログ。tilt / 続行傾向の分析用に、条件と局結果イベントを時刻付きで記録する。
// 既定では localStorage に貯めつつ console に出す。?log=<url> があれば併せて POST。
class Logger {
    constructor(cond) {
        this._cond = cond;
        this._key  = `Majiang.exp.${cond.pid}`;
        this._t0   = (typeof performance !== 'undefined') ? performance.now() : 0;
    }
    event(name, data) {
        const now = (typeof performance !== 'undefined') ? performance.now() : 0;
        const rec = {
            pid:  this._cond.pid,
            wipe: this._cond.mode,
            name,
            t:    Math.round(now - this._t0),   // セッション開始からの経過ms
            ...data,
        };
        try {
            const log = JSON.parse(localStorage.getItem(this._key) || '[]');
            log.push(rec);
            localStorage.setItem(this._key, JSON.stringify(log));
        } catch (e) { /* localStorage不可でも続行 */ }
        // eslint-disable-next-line no-console
        console.info('[exp]', rec);
        if (this._cond.logUrl) {
            try {
                navigator.sendBeacon
                    ? navigator.sendBeacon(this._cond.logUrl,
                          new Blob([JSON.stringify(rec)], {type:'application/json'}))
                    : fetch(this._cond.logUrl, {method:'POST', keepalive:true,
                          headers:{'Content-Type':'application/json'},
                          body: JSON.stringify(rec)}).catch(()=>{});
            } catch (e) { /* 送信失敗は無視 */ }
        }
    }
}

module.exports = { condition, urlMode, Logger, MODES };
