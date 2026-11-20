window.__ModuleLoader__.load({
  id: 'dsh-plugin-starpost',
  factory(require) {
    const React = require('react');
    const url = '/starpost/settings/';
    function Panel() {
      return React.createElement('section', {style:{width:'100%',minWidth:0}},
        React.createElement('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'在独立窗口打开星邮设置 ↗'),
        React.createElement('iframe',{src:url,title:'星邮配置',style:{display:'block',width:'100%',height:'min(78vh, 900px)',minHeight:360,border:0,marginTop:12}}));
    }
    return {inject:['slots'],apply(ctx) {
      ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'dsh-plugin-starpost'},Panel));
      ctx.slots.inject('settings.plugins.tab',()=>ctx.slots.register({name:'settings.plugins.tab',id:'starpost',order:40,label:()=>'星邮'},Panel));
    }};
  }
});
