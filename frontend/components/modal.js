export function diffLines(a, b) {
  const aLines = a.split("\n"), bLines = b.split("\n");
  const n = aLines.length, m = bLines.length;
  const dp = Array.from({length: n+1}, () => Array(m+1).fill(0));
  for (let i=n-1;i>=0;i--) for (let j=m-1;j>=0;j--) dp[i][j] = aLines[i]===bLines[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0,outA=[],outB=[];
  while(i<n && j<m){
    if(aLines[i]===bLines[j]){ outA.push(aLines[i]); outB.push(bLines[j]); i++; j++; }
    else if(dp[i+1][j]>=dp[i][j+1]){ outA.push("<del>"+esc(aLines[i])+"</del>"); i++; }
    else{ outB.push("<ins>"+esc(bLines[j])+"</ins>"); j++; }
  }
  while(i<n){ outA.push("<del>"+esc(aLines[i])+"</del>"); i++; }
  while(j<m){ outB.push("<ins>"+esc(bLines[j])+"</ins>"); j++; }
  return {left: outA.join("\n"), right: outB.join("\n")};
}
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
export function showDiffModal(filename, leftContent, rightContent, onSave, onIgnore){
  const bd=document.createElement("div"); bd.className="modal-backdrop";
  const modal=document.createElement("div"); modal.className="modal";
  const header=document.createElement("header");
  const h=document.createElement("div"); h.textContent=filename;
  const btnX=document.createElement("button"); btnX.textContent="×"; btnX.onclick=close;
  header.appendChild(h); header.appendChild(btnX);
  const body=document.createElement("div"); body.className="body";
  const paneL=document.createElement("div"); paneL.className="pane";
  const paneR=document.createElement("div"); paneR.className="pane";
  const preL=document.createElement("pre"); preL.className="diff"; preL.innerHTML=diffLines(leftContent,rightContent).left;
  const preR=document.createElement("pre"); preR.className="diff"; preR.contentEditable="true"; preR.textContent=rightContent;
  paneL.appendChild(preL); paneR.appendChild(preR); body.appendChild(paneL); body.appendChild(paneR);
  const footer=document.createElement("footer");
  const btnIgnore=document.createElement("button"); btnIgnore.textContent="Ignorer";
  const btnSave=document.createElement("button"); btnSave.textContent="Enregistrer"; btnSave.className="primary";
  btnIgnore.onclick=()=>{ onIgnore&&onIgnore(); close(); };
  btnSave.onclick=()=>{ onSave&&onSave(preR.textContent); close(); };
  footer.appendChild(btnIgnore); footer.appendChild(btnSave);
  modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer);
  bd.appendChild(modal); document.body.appendChild(bd); setTimeout(()=>{ bd.style.display="flex"; },10);
  function close(){ bd.remove(); }
}
