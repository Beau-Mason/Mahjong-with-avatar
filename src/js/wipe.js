"use strict";
// 対局中、画面隅にWebカメラ映像を表示し、局の結果に応じて演出する

const REACTIONS = {
    houju:   { text: 'Oh shit…', cls: 'houju',   sound: 'ohshit' }, // 放銃
    tsumora: { text: 'うわ…',     cls: 'tsumora', sound: 'groan'  }, // 被ツモ
    win:     { text: 'やった！',   cls: 'win',     sound: 'yatta'  }, // 自分の和了
};

module.exports = class Wipe {
    constructor(root) {
        this._root   = $(root);
        this._video  = this._root.find('video').get(0);
        this._bubble = this._root.find('.bubble');
        this._sound  = {
            ohshit: new Audio('audio/ohshit.wav'),
            groan:  new Audio('audio/groan.wav'),
            yatta:  new Audio('audio/yatta.wav'),
        };
        this._timer = null;
    }

    // 対局開始のクリック（ユーザー操作）を契機にカメラ許可を求める
    async start() {
        if (this._video.srcObject) return;          // 二重取得を防止
        try {
            const stream = await navigator.mediaDevices
                                   .getUserMedia({ video: true, audio: false });
            this._video.srcObject = stream;
            await this._video.play();
            this._root.removeClass('hide');
        } catch (e) {
            console.warn('camera unavailable:', e);  // 拒否・カメラ無し → 出さない
            this._root.addClass('hide');
        }
    }

    react(type) {
        const r = REACTIONS[type];
        if (! r) return;
        clearTimeout(this._timer);
        this._root.removeClass('houju tsumora win').addClass(r.cls);
        this._bubble.text(r.text).addClass('show');
        const a = this._sound[r.sound];
        if (a) { a.currentTime = 0; a.play().catch(()=>{}); }
        else if (window.speechSynthesis)             // 効果音が無い場合の保険
            speechSynthesis.speak(new SpeechSynthesisUtterance(r.text));
        this._timer = setTimeout(()=>{
            this._root.removeClass('houju tsumora win');
            this._bubble.removeClass('show');
        }, 2500);
    }
};
