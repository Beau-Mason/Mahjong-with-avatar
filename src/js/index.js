/*!
 *  電脳麻将 v2.5.1
 *
 *  Copyright(C) 2017 Satoshi Kobayashi
 *  Released under the MIT license
 *  https://github.com/kobalab/Majiang/blob/master/LICENSE
 */
"use strict";

const { hide, show, fadeIn, scale,
        setSelector, clearSelector  } = Majiang.UI.Util;

const createWipe = require('./wipe');
const { urlMode } = require('./wipe/condition');
const enrich = require('./rich');

let loaded;

$(function(){

    let game;
    const pai   = Majiang.UI.pai($('#loaddata'));
    const audio = Majiang.UI.audio($('#loaddata'));

    const analyzer = (kaiju)=>{
        $('body').addClass('analyzer');
        return new Majiang.UI.Analyzer($('#board > .analyzer'), kaiju, pai,
                                        ()=>$('body').removeClass('analyzer'));
    };
    const viewer = (paipu)=>{
        $('#board .controller').addClass('paipu')
        $('body').attr('class','board');
        scale($('#board'), $('#space'));
        const _viewer
                = new Majiang.UI.Paipu(
                        $('#board'), paipu, pai, audio, 'Majiang.pref',
                        ()=>fadeIn($('body').attr('class','file')),
                        analyzer);
        delete _viewer._view.dummy_name;
        return _viewer;
    };
    const stat = (paipu_list)=>{
        fadeIn($('body').attr('class','stat'));
        return new Majiang.UI.PaipuStat($('#stat'), paipu_list,
                        ()=>fadeIn($('body').attr('class','file')));
    };
    const file = new Majiang.UI.PaipuFile($('#file'), 'Majiang.game',
                                            viewer, stat);
    const rule = Majiang.rule(
                    JSON.parse(localStorage.getItem('Majiang.rule')||'{}'));

    // ワイプは条件(avatar/video/none)決定時に生成する。
    // 条件はタイトル画面で選択するか、URL ?wipe= で固定する（研究者リンク用）。
    let wipe;

    // デバッグ用: 対局中に z=放銃 / x=被ツモ / c=和了 の演出を任意に出す
    const DEBUG_KEYS = { z: 'houju', x: 'tsumora', c: 'win' };
    $(window).on('keyup.wipedebug', (ev)=>{
        const type = DEBUG_KEYS[ev.key];
        if (type && wipe) wipe.react(type);
    });

    // 人間プレイヤーを拡張して放銃などを検知し、ワイプを反応させる
    class HumanPlayer extends Majiang.UI.Player {
        action_hule(hule) {
            if (hule) { // ※ 流局時は action_pingju から引数なしで呼ばれるためガード
                if (hule.baojia != null && hule.baojia === this._menfeng)
                    wipe && wipe.react('houju');     // 自分の捨て牌に振り込んだ = 放銃
                else if (hule.l === this._menfeng)
                    wipe && wipe.react('win');       // 自分の和了
                else if (hule.baojia == null)
                    wipe && wipe.react('tsumora');   // 他家のツモ和了 = 被ツモ
            }
            super.action_hule(hule);
        }
    }

    // 条件を選んで対局開始（タイトル/牌譜一覧のボタン用）。
    // 既に別条件のワイプがあれば破棄して作り直す（条件の切替を許可）。
    function chooseAndStart(mode) {
        if (wipe && wipe.condition.mode !== mode) { wipe.dispose(); wipe = null; }
        if (! wipe) wipe = createWipe($('#wipe'), mode);
        start();
    }

    function start() {
        if (! wipe) wipe = createWipe($('#wipe'));   // 牌譜一覧からの再開等のフォールバック
        wipe.start();    // クリック契機でカメラ許可を要求
        let players = [ new HumanPlayer($('#board'), pai, audio) ];
        for (let i = 1; i < 4; i++) {
            players[i] = new Majiang.AI();
        }
        game = new Majiang.Game(players, end, rule);
        game.view = new Majiang.UI.Board($('#board .board'),
                                        pai, audio, game.model);
        enrich(game);    // テンポ調整＋手出し/ツモ切りの可視化

        $('#board .controller').removeClass('paipu')
        $('body').attr('class','board');
        scale($('#board'), $('#space'));

        new Majiang.UI.GameCtl($('#board'), 'Majiang.pref', game, game._view);
        game.kaiju();
    }

    function end(paipu) {
        if (paipu) file.add(paipu, 10);
        fadeIn($('body').attr('class','file'));
        file.redraw();
    }

    // 牌譜一覧画面（再訪時に着地する画面）の対局開始ボタン。
    // URLで条件固定なら単一「対局開始」、そうでなければ3条件から選択。
    if (urlMode()) {
        $('#file .start').removeClass('hide').on('click', ()=> chooseAndStart(urlMode()));
    }
    else {
        $('#file .modes').removeClass('hide');
        $('#file .modes .mode').on('click', function(){
            chooseAndStart($(this).attr('data-wipe'));
        });
    }

    $(window).on('resize', ()=>scale($('#board'), $('#space')));

    setTimeout(()=>{
        $(window).on('load', function(){
            if (! file.isEmpty) return end();
            hide($('#title .loading'));
            if (urlMode()) {
                // URLで条件固定（研究者リンク）→ 単一STARTで開始
                $('#title .start')
                    .attr('tabindex', 0).attr('role','button')
                    .on('click', ()=>{
                        clearSelector('title');
                        chooseAndStart(urlMode());
                    });
                show(setSelector($('#title .start'), 'title',
                                { focus: null, touch: false }));
            }
            else {
                // タイトルから条件を選んで開始
                $('#title .modes .mode').on('click', function(){
                    clearSelector('title');
                    chooseAndStart($(this).attr('data-wipe'));
                });
                $('#title .modes').removeClass('hide');
            }
        });
        if (loaded) $(window).trigger('load');
    }, 1000);
});

$(window).on('load', ()=> loaded = true);
