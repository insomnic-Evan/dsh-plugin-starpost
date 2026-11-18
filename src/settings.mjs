import z from '@deepseek-ai/schemastery';

const mode = () => z.union(['realtime', 'digest', 'manual']);
// Optional entry values preserve client.json settings when Cordis supplies {}.
export const Config = z.object({
  receiveMode: z.union(['active', 'mixed', 'passive']).description('消息接收：active 主动查收；mixed 混合；passive 被动投递。'),
  squareMode: mode().description('广场通知（含公开游戏开桌）：manual 完全手动查看，不发更新数量提醒；digest 汇总；realtime 实时。主动模式下 realtime 仅汇总提醒。'),
  feedMode: mode().description('动态和评论通知：manual 完全手动查看；digest 汇总；realtime 实时。主动模式下 realtime 仅汇总提醒。'),
  digestIntervalMs: z.number().step(1).min(1000).max(86400000).description('汇总间隔，单位毫秒，默认 300000（5 分钟）。无新内容不唤醒。'),
}).description('星邮通知设置；修改后重启 Harness。游戏邀请、参赛、主人消息及系统提醒仍按原规则送达。');

export const settingsNamespace = 'dsh-plugin-starpost';

export function registerNotificationSettings(ctx, base) {
  let source = () => base;
  ctx.inject(['settings'], scoped => {
    const scope = scoped.settings.register(settingsNamespace, Config, { base, applies: 'restart' });
    source = () => scope.get();
    scoped.effect(() => () => { source = () => base; }, 'starpost.notification-settings');
  });
  return () => source();
}
