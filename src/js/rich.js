"use strict";
// 対局演出のリッチ化（第1弾）
//
//  (1) AIのテンポ: 前家の打牌→0.5秒後にツモ→その1秒後に打牌。
//      Game は call_players(type, msg, timeout) の timeout だけ「その状態」を表示して
//      next() で進む。timeout を type 別に固定するだけでテンポを作れる。
//      next() は全員の応答が揃うまで進まない(game.js)ので、人間の手番の待ちは壊れない。
//
//  (2) 手出し/ツモ切りの可視化:
//      ツモ牌の右分離・ツモ切りでの分離牌消し・手出しでの手牌消し＋整列は
//      ライブラリ(Majiang.UI.Shoupai)が既に実装済み。ここでは手出し時に消す牌を
//      「手牌の中央付近」に寄せる（既定は一様ランダム）。ツモ牌の分離強調はCSS側。

// アクション別テンポ(ms)。call_players の待ち時間 = その状態の表示時間。
//   zimo / gangzimo … ツモ表示 → 打牌までの間（1秒）
//   dapai           … 打牌表示 → 次家ツモまでの間（0.5秒）
//   fulou / gang    … 鳴き → 打牌までの間
const TEMPO = { zimo: 1000, gangzimo: 1000, dapai: 500, fulou: 800, gang: 800 };

function applyTempo(game) {
    const _call = game.call_players.bind(game);
    game.call_players = (type, msg, timeout) => {
        if (timeout == null && TEMPO[type] != null) timeout = TEMPO[type];
        return _call(type, msg, timeout);
    };
}

// 手出し時に消す手牌を中央付近に寄せる（ツモ切り・自分の公開手牌は既存動作のまま）。
// Board は手番ごとに Shoupai インスタンスを作り直すため、redraw 後に都度差し替える。
function patchShoupai(board) {
    const list = (board._view && board._view.shoupai) || [];
    for (const sp of list) {
        if (! sp || sp._richDapai) continue;
        const orig = Object.getPrototypeOf(sp).dapai;
        sp.dapai = function(p) {
            // 非公開手牌(=他家)の手出し(ツモ切りでない)のみ中央寄せ
            if (! this._open && p[2] !== '_') {
                const tiles = this._node.bingpai.children('.pai');  // ツモ牌(.zimo内)は除外
                const n = tiles.length;
                if (n > 0) {
                    const lo   = Math.floor(n * 0.25);
                    const span = Math.max(1, Math.ceil(n * 0.5));   // 中央50%の範囲から
                    const idx  = Math.min(n - 1, lo + (Math.random() * span | 0));
                    tiles.eq(idx).addClass('deleted');
                    return this;
                }
            }
            return orig.call(this, p);   // ツモ切り/自分の手牌は元の処理
        };
        sp._richDapai = true;
    }
}

function enrichBoard(board) {
    const _redraw = board.redraw.bind(board);
    board.redraw = function(...a) {
        const r = _redraw(...a);
        try { patchShoupai(board); } catch (e) { console.warn('rich: patch failed', e); }
        return r;
    };
}

// game とその view(Board) にリッチ化を適用する。game.view 設定後・kaiju前に呼ぶ。
module.exports = function enrich(game) {
    applyTempo(game);
    if (game.view) enrichBoard(game.view);
};
