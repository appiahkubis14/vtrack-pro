class o{constructor(t){this.element=t,this.value=parseInt(t.getAttribute("data-value"))||0,this.size=parseInt(t.getAttribute("data-size"))||100,this.color=t.getAttribute("data-color")||"#0d6efd",this.text=t.getAttribute("data-text"),this.strokeWidth=t.hasAttribute("data-stroke-width")?parseInt(t.getAttribute("data-stroke-width")):6,this.bgStrokeWidth=t.hasAttribute("data-bg-stroke-width")?parseInt(t.getAttribute("data-bg-stroke-width")):this.strokeWidth,this.bgColor=t.getAttribute("data-bg-color")||"#eee",this.init(),this.animate()}init(){const t=this.size/2-Math.max(this.strokeWidth,this.bgStrokeWidth)/2,s=2*Math.PI*t,i=s-this.value/100*s;this.element.style.width=`${this.size}px`,this.element.style.height=`${this.size}px`,this.element.innerHTML=`
            <svg width="${this.size}" height="${this.size}" viewBox="0 0 ${this.size} ${this.size}">
                ${this.bgStrokeWidth>0?`<circle class="progress-bg" 
                        cx="${this.size/2}" 
                        cy="${this.size/2}" 
                        r="${t}" 
                        stroke="${this.bgColor}" 
                        stroke-width="${this.bgStrokeWidth}"/>`:""}
                <circle class="progress-fill" 
                        cx="${this.size/2}" 
                        cy="${this.size/2}" 
                        r="${t}" 
                        stroke="${this.color}" 
                        stroke-width="${this.strokeWidth}" 
                        stroke-dasharray="${s}" 
                        stroke-dashoffset="${s}"/>
            </svg>
            <div class="progress-text">
                <div class="progress-text-inner">
                    <div class="animate-count">0%</div>
                    ${this.text?`<div class="small">${this.text}</div>`:""}
                </div>
            </div>
        `,this.fillElement=this.element.querySelector(".progress-fill"),this.countElement=this.element.querySelector(".animate-count"),this.radius=t,this.circumference=s,this.offset=i}animate(){setTimeout(()=>{this.fillElement.style.strokeDashoffset=this.offset;let t=0;const s=this.value,r=s/(1e3/16),h=setInterval(()=>{t+=r,t>=s&&(t=s,clearInterval(h)),this.countElement.textContent=Math.round(t)+"%"},16)},100)}}document.addEventListener("DOMContentLoaded",function(){document.querySelectorAll(".progress-circle").forEach(e=>{new o(e)})});
