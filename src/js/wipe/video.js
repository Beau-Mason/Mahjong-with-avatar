"use strict";
// video条件: 実際のカメラ映像をワイプ表示し、局結果で枠色＋吹き出し＋効果音の演出を行う。
// （従来の Wipe 実装をそのまま条件のひとつとして切り出したもの）

const REACTIONS = {
    houju:   { text: 'Oh shit…', cls: 'houju',   sound: 'ohshit' }, // 放銃
    tsumora: { text: 'うわ…',     cls: 'tsumora', sound: 'groan'  }, // 被ツモ
    win:     { text: 'やった！',   cls: 'win',     sound: 'yatta'  }, // 自分の和了
};

module.exports = class VideoWipe {
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

    async start() {
        if (this._video.srcObject) return;
        try {
            const stream = await navigator.mediaDevices
                                   .getUserMedia({ video: true, audio: false });
            this._video.srcObject = stream;
            await this._video.play();
            this._root.removeClass('hide');
        } catch (e) {
            console.warn('camera unavailable:', e);
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
        else if (window.speechSynthesis)
            speechSynthesis.speak(new SpeechSynthesisUtterance(r.text));
        this._timer = setTimeout(()=>{
            this._root.removeClass('houju tsumora win');
            this._bubble.removeClass('show');
        }, 2500);
    }

    dispose() {
        clearTimeout(this._timer);
        if (this._video && this._video.srcObject) {
            this._video.srcObject.getTracks().forEach(t => t.stop());
            this._video.srcObject = null;
        }
    }
};
