"use strict";
// 画面隅のワイプ。実験条件(avatar/video/none)に応じて中身を出し分けるファクトリ。
//
// 条件の決め方・配信方法は ./wipe/condition.js を参照。
// どの条件でも { start(), react(type) } の同一インターフェースを返すので、
// 呼び出し側(index.js)は条件を意識しなくてよい。

const { condition, Logger } = require('./wipe/condition');
const VideoWipe = require('./wipe/video');
const NoneWipe  = require('./wipe/none');

// avatar条件のときだけ AvatarWipe を生成する軽量ファサード。
// 重い three.js / MediaPipe は start() 時に動的importで初めて読み込む
// （= video/none の参加者には一切ダウンロードさせない）。
class AvatarFacade {
    constructor(root, cond) {
        this._root  = $(root);
        this._cond  = cond;
        this._impl  = null;
        this._queue = [];   // 初期化完了前に来たreactを保持
    }
    async start() {
        if (this._impl || this._starting) {   // 再開時の二重初期化を防止
            this._root.removeClass('hide');
            return;
        }
        this._starting = true;
        this._root.removeClass('hide');
        try {
            const { AvatarWipe } = await import(
                /* webpackChunkName: "avatar" */ './wipe/avatar');
            this._impl = new AvatarWipe(this._root, this._cond);
            await this._impl.start();
            for (const t of this._queue) this._impl.react(t);
            this._queue = [];
        } catch (e) {
            console.error('avatar init failed; falling back to hidden wipe:', e);
            this._root.addClass('hide');
        }
    }
    react(type) {
        if (this._impl) this._impl.react(type);
        else this._queue.push(type);   // ロード中に和了等が来たら後追い再生
    }
    dispose() {
        if (this._impl && this._impl.dispose) this._impl.dispose();
        this._impl = null;
        this._starting = false;
    }
}

function build(root, cond) {
    if (cond.mode === 'none')   return new NoneWipe(root);
    if (cond.mode === 'avatar') return new AvatarFacade(root, cond);
    return new VideoWipe(root);   // 既定: video
}

// 公開API: createWipe(root, mode?) → { start(), react(type) }
//   mode を渡すとURLより優先（タイトル画面での条件選択に使用）
module.exports = function createWipe(root, mode) {
    const cond   = condition(mode);
    const logger = new Logger(cond);
    const impl   = build(root, cond);
    // 条件をCSSから参照できるよう<html>に付与（bodyのclassは対局開始で総入替されるため）
    $(document.documentElement).addClass('wipe-' + cond.mode);
    logger.event('session_start', {});

    // react を包んで、演出と同時に実験ログを残す
    return {
        start: () => impl.start(),
        react: (type) => { logger.event('reaction', { type }); impl.react(type); },
        condition: cond,
        log: (name, data) => logger.event(name, data),
        // 条件を切り替える際の後始末（カメラ停止・canvas除去・状態リセット）
        dispose: () => {
            if (impl.dispose) impl.dispose();
            $(document.documentElement).removeClass('wipe-' + cond.mode);
            const $root = $(root);
            $root.addClass('hide').removeClass('avatar houju tsumora win');
            $root.find('.bubble').removeClass('show').text('');
            $root.find('.avatar-canvas').remove();
            const v = $root.find('video').get(0);
            if (v) {
                v.style.display = '';
                if (v.srcObject) {
                    v.srcObject.getTracks().forEach(t => t.stop());
                    v.srcObject = null;
                }
            }
        },
    };
};
