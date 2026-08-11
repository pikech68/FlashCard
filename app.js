import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, writeBatch, serverTimestamp, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp=initializeApp(firebaseConfig); const auth=getAuth(fbApp); const db=getFirestore(fbApp); const provider=new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
const $=id=>document.getElementById(id);
let user=null,cards=[],unsubscribe=null,currentId=null,mode="unlearned",groupFilter="",searchText="",shuffledIds=[],answerVisible=false,editingId=null,pendingImage="",selectedIds=new Set(),stateLoaded=false,saveTimer=null;
const els={login:$('loginScreen'),app:$('app'),loginButton:$('loginButton'),loginMessage:$('loginMessage'),sync:$('syncStatus'),migration:$('migrationBanner'),migrate:$('migrateButton'),search:$('search'),group:$('groupFilter'),progressText:$('progressText'),progressBar:$('progressBar'),modeLabel:$('currentModeLabel'),counter:$('counter'),groupBadge:$('groupBadge'),empty:$('emptyState'),question:$('question'),answer:$('answer'),imageSection:$('imageSection'),cardImage:$('cardImage'),learnedButton:$('learnedButton'),editor:$('editorPanel'),editorTitle:$('editorTitle'),qInput:$('questionInput'),aInput:$('answerInput'),eInput:$('explanationInput'),gInput:$('groupInput'),orderInput:$('orderInput'),photoInput:$('photoInput'),preview:$('preview'),saveButton:$('saveButton'),cancelEdit:$('cancelEditButton'),formMessage:$('formMessage'),listPanel:$('listPanel'),questionList:$('questionList'),listCount:$('listCount'),bulkGroup:$('bulkGroupInput'),groupSuggestions:$('groupSuggestions')};

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.add('hidden'),2600)}
function normalize(c,id){return{id,question:c.question||c.q||'',answer:c.answer||c.a||'',explanation:c.explanation||'',image:c.image||'',group:c.group||'未分類',learned:Boolean(c.learned),order:Number.isFinite(Number(c.order))?Number(c.order):999999,createdAt:c.createdAt||null,updatedAt:c.updatedAt||null}}
function sortedCards(){return [...cards].sort((a,b)=>a.order-b.order||a.question.localeCompare(b.question,'ja'))}
function visibleCards(){let list=sortedCards();if(mode==='unlearned')list=list.filter(c=>!c.learned);if(mode==='learned')list=list.filter(c=>c.learned);if(groupFilter)list=list.filter(c=>c.group===groupFilter);if(searchText){const k=searchText.toLowerCase();list=list.filter(c=>(c.question+' '+c.answer+' '+c.explanation+' '+c.group).toLowerCase().includes(k))}if(shuffledIds.length){const map=new Map(list.map(c=>[c.id,c]));list=shuffledIds.map(id=>map.get(id)).filter(Boolean)}return list}
function currentCard(){const list=visibleCards();let c=list.find(x=>x.id===currentId);if(!c&&list.length){c=list[0];currentId=c.id}return c||null}
function updateGroups(){const groups=[...new Set(cards.map(c=>c.group||'未分類'))].sort((a,b)=>a.localeCompare(b,'ja'));const current=els.group.value;els.group.innerHTML='<option value="">すべてのグループ</option>'+groups.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');els.group.value=groups.includes(current)?current:'';els.groupSuggestions.innerHTML=groups.map(g=>`<option value="${escapeHtml(g)}"></option>`).join('')}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function render(){updateGroups();const list=visibleCards(),card=currentCard();const learned=cards.filter(c=>c.learned).length;els.progressText.textContent=`${learned} / ${cards.length}問 習得`;els.progressBar.style.width=cards.length?`${learned/cards.length*100}%`:'0%';els.modeLabel.textContent=mode==='unlearned'?'未習得のみ':mode==='learned'?'習得済み':'すべて';document.querySelectorAll('.mode-button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));if(!card){els.counter.textContent='0問';els.empty.classList.remove('hidden');els.question.textContent='';els.groupBadge.classList.add('hidden');els.answer.classList.add('hidden');els.imageSection.classList.add('hidden');return}els.empty.classList.add('hidden');const idx=list.findIndex(c=>c.id===card.id);els.counter.textContent=`${idx+1} / ${list.length}問`;els.groupBadge.textContent=card.group;els.groupBadge.classList.remove('hidden');els.question.textContent=card.question;els.learnedButton.textContent=card.learned?'覚えたを解除':'覚えた';els.learnedButton.classList.toggle('success',!card.learned);if(answerVisible){els.answer.textContent=`【正解】\n${card.answer}\n\n【解説】\n${card.explanation||'解説なし'}`;els.answer.classList.remove('hidden');if(card.image){els.cardImage.src=card.image;els.imageSection.classList.remove('hidden')}else els.imageSection.classList.add('hidden')}else{els.answer.classList.add('hidden');els.imageSection.classList.add('hidden')}scheduleStateSave()}
function navigate(delta){const list=visibleCards();if(!list.length)return;const i=Math.max(0,list.findIndex(c=>c.id===currentId));currentId=list[(i+delta+list.length)%list.length].id;answerVisible=false;render()}
function scheduleStateSave(){if(!user||!stateLoaded)return;clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{try{await setDoc(doc(db,'users',user.uid,'meta','state'),{currentId,mode,groupFilter,searchText,answerVisible,updatedAt:serverTimestamp()},{merge:true})}catch(e){console.error(e)}},400)}
async function loadState(){const snap=await getDoc(doc(db,'users',user.uid,'meta','state'));if(snap.exists()){const s=snap.data();mode=['unlearned','all','learned'].includes(s.mode)?s.mode:'unlearned';groupFilter=s.groupFilter||'';searchText=s.searchText||'';currentId=s.currentId||null;answerVisible=Boolean(s.answerVisible);els.search.value=searchText}else{mode='unlearned'}stateLoaded=true}
function listenCards(){if(unsubscribe)unsubscribe();els.sync.textContent='同期中…';const q=query(collection(db,'users',user.uid,'cards'),orderBy('order'));unsubscribe=onSnapshot(q,s=>{cards=s.docs.map(d=>normalize(d.data(),d.id));els.sync.textContent='同期済み';if(groupFilter&&!cards.some(c=>c.group===groupFilter))groupFilter='';els.group.value=groupFilter;render();updateMigrationBanner()},e=>{els.sync.textContent='同期エラー';toast('同期できません。Firestoreルールを確認してください。');console.error(e)})}
function updateMigrationBanner(){let old=[];try{old=JSON.parse(localStorage.getItem('careerCardsV2')||'[]')}catch{}const migrated=localStorage.getItem('careerCardsV2Migrated')==='true';els.migration.classList.toggle('hidden',migrated||!old.length)}
async function login(){els.loginMessage.textContent='ログイン中…';try{await signInWithPopup(auth,provider)}catch(e){if(['auth/popup-blocked','auth/cancelled-popup-request','auth/operation-not-supported-in-this-environment'].includes(e.code)){await signInWithRedirect(auth,provider)}else els.loginMessage.textContent='ログインできませんでした。'} }
async function migrateLocal(){let old=[];try{old=JSON.parse(localStorage.getItem('careerCardsV2')||'[]')}catch{}if(!old.length)return;const existing=new Set(cards.map(c=>(c.question+'|'+c.answer).trim()));const fresh=old.map((c,i)=>normalize(c,crypto.randomUUID())).filter(c=>c.question&&c.answer&&!existing.has((c.question+'|'+c.answer).trim()));if(!fresh.length){localStorage.setItem('careerCardsV2Migrated','true');els.migration.classList.add('hidden');toast('旧データは移行済みです');return}if(!confirm(`${fresh.length}問をクラウドへ移しますか？`))return;els.sync.textContent='移行中…';for(let i=0;i<fresh.length;i+=300){const batch=writeBatch(db);fresh.slice(i,i+300).forEach((c,j)=>batch.set(doc(db,'users',user.uid,'cards',c.id),{question:c.question,answer:c.answer,explanation:c.explanation,image:c.image,group:c.group||'未分類',learned:false,order:cards.length+i+j+1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));await batch.commit()}localStorage.setItem('careerCardsV2Migrated','true');els.migration.classList.add('hidden');toast(`${fresh.length}問を移しました`)}
async function saveCard(){const question=els.qInput.value.trim(),answer=els.aInput.value.trim(),explanation=els.eInput.value.trim(),group=els.gInput.value.trim()||'未分類';if(!question||!answer){els.formMessage.textContent='問題と正解を入力してください。';return}let order=Number(els.orderInput.value);if(!Number.isFinite(order)||order<1)order=Math.max(0,...cards.map(c=>c.order||0))+1;const id=editingId||crypto.randomUUID();const old=cards.find(c=>c.id===id);try{await setDoc(doc(db,'users',user.uid,'cards',id),{question,answer,explanation,image:pendingImage,group,learned:old?.learned||false,order,createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});editingId=null;clearForm();els.editorTitle.textContent='問題を追加';els.saveButton.textContent='保存';els.cancelEdit.classList.add('hidden');currentId=id;mode='all';answerVisible=false;els.formMessage.textContent='保存しました。';toast('保存しました')}catch(e){els.formMessage.textContent='保存できませんでした。画像が大きすぎる可能性があります。';console.error(e)}}
function editCurrent(){const c=currentCard();if(!c)return;editingId=c.id;els.qInput.value=c.question;els.aInput.value=c.answer;els.eInput.value=c.explanation;els.gInput.value=c.group;els.orderInput.value=c.order;pendingImage=c.image||'';updatePreview();els.editorTitle.textContent='問題を編集';els.saveButton.textContent='変更を保存';els.cancelEdit.classList.remove('hidden');els.editor.open=true;els.editor.scrollIntoView({behavior:'smooth'});setTimeout(()=>els.qInput.focus(),300)}
function clearForm(){els.qInput.value='';els.aInput.value='';els.eInput.value='';els.gInput.value='';els.orderInput.value='';els.photoInput.value='';pendingImage='';updatePreview();els.formMessage.textContent=''}
function cancelEdit(){editingId=null;clearForm();els.editorTitle.textContent='問題を追加';els.saveButton.textContent='保存';els.cancelEdit.classList.add('hidden')}
async function deleteCurrent(){const c=currentCard();if(!c||!confirm('この問題を削除しますか？'))return;await deleteDoc(doc(db,'users',user.uid,'cards',c.id));currentId=null;answerVisible=false;toast('削除しました')}
async function toggleLearned(){const c=currentCard();if(!c)return;await setDoc(doc(db,'users',user.uid,'cards',c.id),{learned:!c.learned,updatedAt:serverTimestamp()},{merge:true});if(mode==='unlearned'&&!c.learned){const list=visibleCards().filter(x=>x.id!==c.id);currentId=list[0]?.id||null}toast(!c.learned?'覚えたにしました':'未習得に戻しました')}
async function moveCurrent(direction){
  if(mode!=='all'||groupFilter||searchText||shuffledIds.length){
    toast('順番変更は「すべて」モードで、検索・グループ・ランダムを解除して行ってください');
    return;
  }
  const list=sortedCards();
  const index=list.findIndex(c=>c.id===currentId);
  if(index<0)return;
  const target=index+direction;
  if(target<0){toast('この問題はすでに先頭です');return}
  if(target>=list.length){toast('この問題はすでに最後です');return}
  [list[index],list[target]]=[list[target],list[index]];
  try{
    els.sync.textContent='並び替え中…';
    for(let start=0;start<list.length;start+=400){
      const batch=writeBatch(db);
      list.slice(start,start+400).forEach((card,offset)=>{
        batch.set(doc(db,'users',user.uid,'cards',card.id),{
          order:start+offset+1,
          updatedAt:serverTimestamp()
        },{merge:true});
      });
      await batch.commit();
    }
    currentId=list[target].id;
    answerVisible=false;
    toast(direction<0?'1つ前に移動しました':'1つ後ろに移動しました');
  }catch(e){
    console.error(e);
    toast('順番を変更できませんでした');
  }
}

function shuffle(){const list=visibleCards();shuffledIds=list.map(c=>c.id);for(let i=shuffledIds.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffledIds[i],shuffledIds[j]]=[shuffledIds[j],shuffledIds[i]]}currentId=shuffledIds[0]||null;answerVisible=false;render()}
function renderList(){selectedIds.clear();const groups=new Map();sortedCards().forEach(c=>{if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c)});els.questionList.innerHTML='';els.listCount.textContent=`${cards.length}問`;for(const [g,list] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ja'))){const sec=document.createElement('section');sec.className='group-section';const title=document.createElement('div');title.className='group-title';title.textContent=`${g}（${list.length}問）`;sec.appendChild(title);list.forEach((c)=>{const row=document.createElement('div');row.className='list-item';const cb=document.createElement('input');cb.type='checkbox';cb.dataset.cardId=c.id;cb.addEventListener('change',()=>cb.checked?selectedIds.add(c.id):selectedIds.delete(c.id));const num=document.createElement('span');num.className='list-num';num.textContent=String(c.order);const text=document.createElement('button');text.className='list-text';text.textContent=c.question.replace(/\s+/g,' ').trim();text.addEventListener('click',()=>{mode='all';groupFilter='';searchText='';els.search.value='';els.group.value='';shuffledIds=[];currentId=c.id;answerVisible=false;els.listPanel.classList.add('hidden');render();document.querySelector('.study-card').scrollIntoView({behavior:'smooth'})});const mark=document.createElement('span');mark.className='learned-mark';mark.textContent=c.learned?'✓':'';row.append(cb,num,text,mark);sec.appendChild(row)});els.questionList.appendChild(sec)}}

async function deleteAllQuestions(){
  if(!user)return;
  if(!cards.length){toast('削除する問題はありません');return}
  if(!confirm(`登録されている${cards.length}問をすべて削除します。\n\nPC・スマホの両方から消え、元に戻せません。\n\n本当に削除しますか？`))return;
  const typed=prompt('誤操作防止のため「全削除」と入力してください。');
  if(typed!=='全削除'){toast('全問題削除を中止しました');return}
  try{
    els.sync.textContent='全問題を削除中…';
    const ids=cards.map(c=>c.id);
    for(let i=0;i<ids.length;i+=400){
      const batch=writeBatch(db);
      ids.slice(i,i+400).forEach(id=>batch.delete(doc(db,'users',user.uid,'cards',id)));
      await batch.commit();
    }
    currentId=null; answerVisible=false; selectedIds.clear();
    localStorage.setItem('careerCardsV2Migrated','true');
    els.migration.classList.add('hidden');
    els.listPanel.classList.add('hidden');
    await setDoc(doc(db,'users',user.uid,'meta','state'),{
      currentId:null,mode:'unlearned',groupFilter:'',searchText:'',answerVisible:false,updatedAt:serverTimestamp()
    },{merge:true});
    mode='unlearned'; groupFilter=''; searchText=''; shuffledIds=[]; els.search.value='';
    toast('全問題を削除しました');
  }catch(e){
    console.error(e);
    toast('全問題を削除できませんでした。通信状態を確認してください。');
  }
}

async function applyBulkGroup(){const group=els.bulkGroup.value.trim();if(!group||!selectedIds.size){toast('問題を選び、グループ名を入力してください');return}const batch=writeBatch(db);selectedIds.forEach(id=>batch.set(doc(db,'users',user.uid,'cards',id),{group,updatedAt:serverTimestamp()},{merge:true}));await batch.commit();toast(`${selectedIds.size}問を「${group}」にまとめました`);renderList()}
async function processImage(file){if(!file)return;const data=await fileToDataURL(file),img=await loadImage(data);const max=720,scale=Math.min(1,max/Math.max(img.width,img.height)),w=Math.round(img.width*scale),h=Math.round(img.height*scale),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);let q=.72;let result=canvas.toDataURL('image/jpeg',q);while(result.length>650000&&q>.35){q-=.08;result=canvas.toDataURL('image/jpeg',q)}if(result.length>750000){toast('画像が大きすぎます。小さい画像を選んでください');return}pendingImage=result;updatePreview()}
function fileToDataURL(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)})}function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src})}function updatePreview(){if(pendingImage){els.preview.src=pendingImage;els.preview.classList.remove('hidden')}else els.preview.classList.add('hidden')}

$('loginButton').addEventListener('click',login);$('logoutButton').addEventListener('click',()=>signOut(auth));els.migrate.addEventListener('click',migrateLocal);document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;shuffledIds=[];currentId=null;answerVisible=false;render()}));els.group.addEventListener('change',()=>{groupFilter=els.group.value;shuffledIds=[];currentId=null;answerVisible=false;render()});els.search.addEventListener('input',()=>{searchText=els.search.value.trim();shuffledIds=[];currentId=null;answerVisible=false;render()});$('shuffleButton').addEventListener('click',shuffle);$('moveUpButton').addEventListener('click',()=>moveCurrent(-1));$('moveDownButton').addEventListener('click',()=>moveCurrent(1));$('prevButton').addEventListener('click',()=>navigate(-1));$('nextButton').addEventListener('click',()=>navigate(1));$('answerButton').addEventListener('click',()=>{answerVisible=!answerVisible;render()});els.learnedButton.addEventListener('click',toggleLearned);$('editButton').addEventListener('click',editCurrent);$('deleteButton').addEventListener('click',deleteCurrent);els.saveButton.addEventListener('click',saveCard);els.cancelEdit.addEventListener('click',cancelEdit);els.photoInput.addEventListener('change',e=>processImage(e.target.files[0]));$('removePhotoButton').addEventListener('click',()=>{pendingImage='';els.photoInput.value='';updatePreview()});$('listButton').addEventListener('click',()=>{renderList();els.listPanel.classList.remove('hidden');els.listPanel.scrollIntoView({behavior:'smooth'})});$('closeListButton').addEventListener('click',()=>els.listPanel.classList.add('hidden'));$('selectAllButton').addEventListener('click',()=>{selectedIds.clear();document.querySelectorAll('.list-item input[type=checkbox]').forEach(cb=>{cb.checked=true;if(cb.dataset.cardId)selectedIds.add(cb.dataset.cardId)})});$('clearSelectionButton').addEventListener('click',()=>{selectedIds.clear();document.querySelectorAll('.list-item input[type=checkbox]').forEach(cb=>cb.checked=false)});$('applyGroupButton').addEventListener('click',applyBulkGroup);$('deleteAllButton').addEventListener('click',deleteAllQuestions);

getRedirectResult(auth).catch(console.error);
onAuthStateChanged(auth,async u=>{user=u;if(!u){if(unsubscribe)unsubscribe();els.login.classList.remove('hidden');els.app.classList.add('hidden');return}els.login.classList.add('hidden');els.app.classList.remove('hidden');stateLoaded=false;await loadState();listenCards()});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'));
