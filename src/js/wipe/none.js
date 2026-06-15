"use strict";
// none条件（対照群）: ワイプを一切表示せず、カメラも要求しない。
// イベントは記録のみ（演出なし）。インターフェースは他条件と揃える。

module.exports = class NoneWipe {
    constructor(root) {
        this._root = $(root);
        this._root.addClass('hide');
    }
    async start() { /* 何もしない */ }
    react(/* type */) { /* 演出なし */ }
    dispose() { /* 後始末なし */ }
};
