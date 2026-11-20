// Shared by the local settings form and its allowlisted write API.
const select = (key, label, choices) => ({ key, label, choices, type: 'select' });
const num = (key, label, min, max, scale = 1, step = 1) => ({ key, label, min, max, scale, step, type: 'number' });
const str = (key, label, hint) => ({ key, label, hint, type: 'text' });
const protocol = [['openai','OpenAI 兼容'],['json','JSON']];
const notify = [['manual','手动查看'],['digest','汇总提醒'],['realtime','实时提醒']];
export const sections = {
  notify: { title:'消息接收', hint:'日常聊天按所选模式接收。主人专属消息和参赛消息仍会及时送达。广场或动态选择手动查看后，也会关闭更新数量提醒。', fields:[
    select('receiveMode','日常聊天',[['active','主动查看'],['passive','被动投递'],['mixed','混合模式']]),
    select('squareMode','广场与公开开桌',notify), select('feedMode','好友动态与评论',notify),
    num('digestIntervalMs','汇总间隔（秒）',1000,86400000,1000)
  ]},
  limits: { title:'额度与防刷', hint:'工作日时段按北京时间计算。周末保留每日额度。', fields:[
    num('maxMessagesPerDay','每日消息数',0,1000000),num('maxWerewolfGamesPerDay','每日狼人杀局数',0,1000),
    num('maxPrivateChats','私聊数量上限',0,1000),num('maxGroups','群聊数量上限',0,1000),
    num('deliveryIntervalMs','聊天合批间隔（秒）',1000,300000,1000),
    num('periodLimits.morning','09:00–12:00 消息数',0,1000000),num('periodLimits.afternoon','14:00–18:00 消息数',0,1000000),
    num('periodLimits.sleep','00:00–06:00 消息数',0,1000000),num('groupSpeak.maxPerWindow','单群窗口发言数',1,1000),
    num('groupSpeak.windowSec','群聊窗口（秒）',1,86400),num('antiLoop.maxConsecutiveBotTurns','连续发言上限',1,100),
    num('antiLoop.idleToEndSec','静默收尾（秒）',0,86400),num('proactive.topicSimilarity','主动话题相似度上限',0,1,1,'any')
  ]},
  media: {title:'表情包', hint:'目录可以填写本机 qq-final 的 emoji 路径。需要导入旧标签时，可指定 QQ 标签索引文件。', fields:[
    str('emojiDir','表情包目录','留空使用插件数据目录中的 emoji'),
    {key:'sticker.enabled',label:'自动收藏收到的表情包',type:'checkbox'},
    num('sticker.maxFiles','收藏数量上限',1,50000),str('sticker.qqIndexFile','QQ 标签索引路径（可选）')
  ]},
  speech: {title:'语音与转换',hint:'可接入本机或云端服务。密钥字段只填写环境变量名，由运行 DSH 的进程读取。',fields:[
    str('speech.audioDir','语音文件目录'),str('speech.asrUrl','语音识别 ASR 接口'),select('speech.asrProtocol','ASR 协议',protocol),
    str('speech.asrModel','识别模型'),str('speech.asrKeySecret','ASR 密钥环境变量名'),
    str('speech.ttsUrl','语音合成 TTS 接口'),select('speech.ttsProtocol','TTS 协议',protocol),
    str('speech.ttsModel','合成模型'),str('speech.ttsVoice','音色'),str('speech.ttsKeySecret','TTS 密钥环境变量名'),
    str('speech.ffmpegPath','FFmpeg 可执行文件路径'),str('speech.silkPath','SILK 解码器路径'),
    str('speech.converterUrl','音频转换 HTTP 接口'),str('speech.converterKeySecret','转换服务密钥环境变量名')
  ]}
};
export function check(field, value) {
  if (field.type === 'select') return field.choices.some(([v]) => v === value);
  if (field.type === 'number') return Number.isFinite(value) && (field.step === 'any' || Number.isInteger(value)) && value >= field.min && value <= field.max;
  if (field.type === 'checkbox') return typeof value === 'boolean';
  return typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function readKey(obj, key) {
  return key.split('.').reduce((value, part) => value?.[part], obj);
}
export function setKey(obj, key, value) {
  const [section, field] = key.split('.');
  if (field) obj[section] = { ...obj[section], [field]:value };
  else obj[key] = value;
}
