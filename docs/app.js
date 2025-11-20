// Minimal single-file app for GitHub Pages
const VIEWS = ['home','live','day','strategy'];
const plotEl = document.getElementById('plot');
const controls = document.getElementById('controls');
const title = document.getElementById('title');

document.querySelectorAll('#sidebar button').forEach(b=>b.addEventListener('click', ()=>showView(b.dataset.view)));
showView('home');

function clearControls(){ controls.innerHTML=''; }

function showView(view){
  if(!VIEWS.includes(view)) view='home';
  title.textContent = view==='home'?'BTC Tools': view==='live'?'Live Price': view==='day'?'Day Chart':'SMA200 3-Day';
  clearControls();
  plotEl.innerHTML='';
  if(view==='home') renderHome();
  if(view==='live') renderLive();
  if(view==='day') renderDayChart();
  if(view==='strategy') renderStrategy();
}

function renderHome(){
  controls.innerHTML= `<div class="row"><p>Wähle eines der Tools links: Livepreis, Tageschart (Candle Density) oder Strategie (SMA200 3-Tage).</p></div>`;
}

async function renderLive(){
  controls.innerHTML = `<div class="row"> <button class="btn" id="refresh">Refresh Price</button> </div>`;
  document.getElementById('refresh').onclick = async ()=>{
    const p = await fetchLivePrice();
    plotEl.innerHTML = `<div style="padding:18px;font-size:20px">BTC-USD: <strong>${p.toLocaleString('de-DE',{style:'currency',currency:'USD'})}</strong></div>`;
  };
  document.getElementById('refresh').click();
}

async function fetchLivePrice(){
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
  const j = await res.json();
  return j.bitcoin.usd;
}

function renderDayChart(){
  controls.innerHTML = `
    <div class="row">
      <label>Datum: <input type="date" id="daydate"></label>
      <label>Candle minutes: <select id="candle"><option>5</option><option>15</option><option selected>60</option><option>240</option><option>1440</option></select></label>
      <button class="btn" id="showday">Show Day</button>
    </div>`;
  document.getElementById('showday').onclick = async ()=>{
    const date = document.getElementById('daydate').value;
    const minutes = parseInt(document.getElementById('candle').value,10);
    if(!date) return alert('Bitte Datum wählen');
    plotEl.innerHTML = '<div style="padding:20px">Lade Daten…</div>';
    const points = await fetchAllPrices();
    const dayMs = new Date(date+'T00:00:00').getTime();
    const nextDayMs = dayMs + 24*3600*1000;
    const filtered = points.filter(p=>p[0]>=dayMs && p[0]<nextDayMs);
    if(filtered.length===0) return plotEl.innerHTML='<div style="padding:20px">Keine Daten für dieses Datum</div>';
    const ohlc = aggregateToOHLC(filtered, minutes);
    plotOHLC(ohlc);
  };
}

function renderStrategy(){
  controls.innerHTML = `
    <div class="row">
      <label>Zeitraum: <select id="period"><option value="30">1M</option><option value="90">3M</option><option value="365">1J</option><option value="1825">5J</option><option value="max" selected>Max</option></select></label>
      <label>Candle minutes: <select id="candle"><option>60</option><option>240</option><option>1440</option></select></label>
      <label>SMA auf Tagesbasis: <input type="checkbox" id="smaDaily" checked></label>
      <label>Startkapital: <input type="number" id="capital" value="404"></label>
      <button class="btn" id="runstr">Run Strategy</button>
    </div>`;
  document.getElementById('runstr').onclick = async ()=>{
    plotEl.innerHTML = '<div style="padding:20px">Lade historische Daten…</div>';
    const period = document.getElementById('period').value;
    const minutes = parseInt(document.getElementById('candle').value,10)||60;
    const smaDaily = document.getElementById('smaDaily').checked;
    const capital = parseFloat(document.getElementById('capital').value)||404;

    const points = await fetchPrices(period);

    // Aggregate to selected candle resolution
    const ohlc = aggregateToOHLC(points, minutes);
    const candleCloses = ohlc.map(o=>o.close);
    const candleDates = ohlc.map(o=>new Date(o.ts));

    let sma = null; let smaDates = null;
    if(smaDaily){
      const daily = toDailyClose(points);
      const dailyCloses = daily.map(d=>d[1]);
      sma = computeSMA(dailyCloses,200);
      smaDates = daily.map(d=>new Date(d[0]));
    } else {
      sma = computeSMA(candleCloses,200);
      smaDates = candleDates;
    }

    const strategy = compute3DayStrategy(candleCloses, sma, capital);
    plotStrategyCandles(ohlc, sma, smaDates, strategy, candleDates);
  };
}

// Fetch prices from CoinGecko for given days ('max' or number)
async function fetchPrices(days){
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url);
  const j = await res.json();
  return j.prices.map(p=>[p[0], p[1]]);
}

async function fetchAllPrices(){
  // fetch full history (CoinGecko supports days=max)
  const res = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max');
  const j = await res.json();
  // j.prices = [[ms, price], ...]
  return j.prices.map(p=>[p[0], p[1]]);
}

function aggregateToOHLC(points, minutes){
  const msPerBucket = minutes*60*1000;
  const buckets = {};
  for(const [ts, price] of points){
    const b = Math.floor(ts / msPerBucket) * msPerBucket;
    if(!buckets[b]) buckets[b] = {open:price,high:price,low:price,close:price,ts:b};
    else{ buckets[b].high=Math.max(buckets[b].high,price); buckets[b].low=Math.min(buckets[b].low,price); buckets[b].close=price; }
  }
  return Object.values(buckets).sort((a,b)=>a.ts-b.ts);
}

function plotOHLC(ohlc){
  const x = ohlc.map(o=>new Date(o.ts));
  const trace = { x, open: ohlc.map(o=>o.open), high: ohlc.map(o=>o.high), low: ohlc.map(o=>o.low), close: ohlc.map(o=>o.close), type:'candlestick', name:'BTC' };
  const layout={margin:{t:30}};
  Plotly.newPlot(plotEl, [trace], layout, {responsive:true});
}

function toDailyClose(points){
  // Group by UTC date and take last price
  const days = {};
  for(const [ts,price] of points){
    const d = new Date(ts);
    const key = d.getUTCFullYear()+'-'+(d.getUTCMonth()+1)+'-'+d.getUTCDate();
    days[key] = [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), price];
  }
  return Object.values(days).sort((a,b)=>a[0]-b[0]);
}

function computeSMA(arr, window){
  const out = new Array(arr.length).fill(null);
  let sum=0; const q=[];
  for(let i=0;i<arr.length;i++){
    const v=arr[i]; q.push(v); sum+=v;
    if(q.length>window) sum-=q.shift();
    if(i>=window-1) out[i]=sum/window;
  }
  return out;
}

function compute3DayStrategy(closes, sma, capital){
  const vals = [capital]; let pos=false; let consecAbove=0, consecBelow=0; let value=capital;
  for(let i=1;i<closes.length;i++){
    const c=closes[i]; const s=sma[i];
    if(s!==null && c>s){ consecAbove++; consecBelow=0; } else { consecBelow++; consecAbove=0; }
    if(consecAbove>=3 && !pos){ pos=true; }
    if(consecBelow>=3 && pos){ pos=false; }
    if(pos){ const prev=closes[i-1]; const ret=(c/prev)-1; value = value * (1+ret); }
    vals.push(value);
  }
  // pad to length
  while(vals.length<closes.length) vals.push(vals[vals.length-1]);
  return vals;
}

function plotStrategyOHLC(daily, sma, strategy, dates){
  const x = dates;
  const priceTrace = { x, y: daily.map(d=>d[1]), type:'scatter', mode:'lines', name:'Close' };
  const smaTrace = { x, y: sma, type:'scatter', mode:'lines', name:'SMA200', line:{color:'red'} };
  const stratTrace = { x, y: strategy, type:'scatter', mode:'lines', name:'Strategy Value', yaxis:'y2', line:{color:'green'} };
  const layout = { title:'BTC SMA200 3-Day Strategy', yaxis:{title:'Price (USD)'}, yaxis2:{overlaying:'y',side:'right',title:'Strategy Value'} };
  Plotly.newPlot(plotEl, [priceTrace, smaTrace, stratTrace], layout, {responsive:true});
}

function plotStrategyCandles(ohlc, sma, smaDates, strategy, candleDates){
  const candleTrace = { x: candleDates, open: ohlc.map(o=>o.open), high: ohlc.map(o=>o.high), low: ohlc.map(o=>o.low), close: ohlc.map(o=>o.close), type:'candlestick', name:'BTC' };
  const smaTrace = { x: smaDates, y: sma, type:'scatter', mode:'lines', name:'SMA200', line:{color:'red'} };
  const stratTrace = { x: candleDates, y: strategy, type:'scatter', mode:'lines', name:'Strategy Value', yaxis:'y2', line:{color:'green'} };
  const layout = { title:'BTC SMA200 3-Day Strategy', yaxis:{title:'Price (USD)'}, yaxis2:{overlaying:'y',side:'right',title:'Strategy Value'}, xaxis:{rangeslider:{visible:false}} };
  Plotly.newPlot(plotEl, [candleTrace, smaTrace, stratTrace], layout, {responsive:true});
}
