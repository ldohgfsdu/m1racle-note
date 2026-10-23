export function createInsertDialog(apply) {
  const dialog=document.getElementById('insert-dialog'),form=document.getElementById('insert-form');
  const title=document.getElementById('insert-title'),label=document.getElementById('insert-label'),target=document.getElementById('insert-target'),language=document.getElementById('insert-language'),error=document.getElementById('insert-error');
  let pending,invalidField=null;
  // Error semantics: aria-invalid + aria-describedby (error first, then hint) only while an error is shown.
  function clearError(){
    error.hidden=true;error.textContent='';
    if(invalidField){invalidField.removeAttribute('aria-invalid');invalidField.setAttribute('aria-describedby','insert-hint');invalidField=null;}
  }
  function showError(message){
    clearError();
    error.textContent=message;error.hidden=false;
    invalidField=pending?.type==='fence'?language:target;
    invalidField.setAttribute('aria-invalid','true');invalidField.setAttribute('aria-describedby','insert-error insert-hint');
  }
  target.setAttribute('aria-describedby','insert-hint');language.setAttribute('aria-describedby','insert-hint');
  function close(){dialog.close();pending?.view.focus();pending=null;}
  document.getElementById('insert-cancel').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  form.onsubmit=event=>{
    event.preventDefault();
    clearError();
    try{apply(pending,{label:label.value,target:target.value,language:language.value.trim()});close();}
    catch(value){showError(value.message);}
  };
  return (type,view)=>{
    const selection=view.state.selection.main;
    pending={type,view,selection,document:view.state.doc,selected:view.state.sliceDoc(selection.from,selection.to)};
    title.textContent=type==='link'?'插入链接':type==='image'?'插入图片':'插入代码块';
    document.getElementById('insert-label-row').hidden=type==='fence';
    document.getElementById('insert-target-row').hidden=type==='fence';
    document.getElementById('insert-language-row').hidden=type!=='fence';
    document.getElementById('insert-target-label').textContent=type==='image'?'图片相对路径':'链接地址';
    document.getElementById('insert-hint').textContent=type==='image'?'图片请放在 Markdown 文件所在目录或其子目录中；支持带空格的文件名。':type==='link'?'支持网页、邮件地址和 #标题 链接。':'可选择常用语言、输入其他语言，或留空。选中的文字会保留为代码内容。';
    label.value=pending.selected;target.value='';language.value='';
    target.placeholder=type==='image'?'images/photo.png':'https://example.com 或 #标题';
    clearError();dialog.showModal();(type==='fence'?language:target).focus();
  };
}
