/**
 * 实时状态面板。宿主的顶部徽章只在开页或手动刷新时取一次，这里在面板打开期间
 * 每 2 秒读取一次 World 快照，让读取状态、曲目、评论区与歌手资料保持最新。
 */
export default {
  panels: {
    'live-status': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const table = ui.h('div');
        const note = ui.msgline('');
        ctx.root.append(table, note);

        const draw = (s) => {
          table.replaceChildren(ui.kv([
            { k: zh ? '读取状态' : 'Reader', v: s.reading },
            { k: zh ? '当前曲目' : 'Track', v: s.track },
            { k: zh ? '播放状态' : 'Playback', v: s.playback },
            { k: zh ? '来源' : 'Source', v: s.method || '-' },
            { k: zh ? '陪听' : 'Commentary', v: s.commentary },
            { k: zh ? '评论区' : 'Comments', v: s.comment },
            { k: zh ? '歌手资料' : 'Artist', v: s.artist },
            { k: zh ? '偏好记忆' : 'Preferences', v: s.preferences || '未启用' },
            { k: zh ? '本次已请求评论' : 'Requests', v: String(s.requests) },
          ]));
          note.textContent = s.observedAt
            ? (zh ? `最近观测 ${new Date(s.observedAt).toLocaleTimeString()}` : `Observed ${new Date(s.observedAt).toLocaleTimeString()}`)
            : (zh ? '尚未观测到播放状态' : 'No observation yet');
          note.classList.remove('bad');
        };

        const tick = async () => {
          try {
            draw(await ctx.invoke('snapshot'));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };

        void tick();
        ctx.interval(() => void tick(), 2000);
      },
    },
  },
};
