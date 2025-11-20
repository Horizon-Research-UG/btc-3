// Minimal single-file app for GitHub Pages
// Hardcoded Twelve Data API key (quick dev convenience). WARNING: storing API keys in code is insecure.
const DEFAULT_TD_KEY = '9c3209171a8c49429322e377f2611bb3';
const VIEWS = ['home','live','day','strategy','portfolio'];
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
  if(view==='portfolio') renderPortfolio();
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
      <label>TwelveData API Key: <input type="text" id="td_key" placeholder="optional"></label>
      <button class="btn" id="showday">Show Day</button>
    </div>`;
  document.getElementById('showday').onclick = async ()=>{
    const date = document.getElementById('daydate').value;
    const minutes = parseInt(document.getElementById('candle').value,10);
    let tdkey = document.getElementById('td_key').value.trim();
    if(!tdkey) tdkey = DEFAULT_TD_KEY;
    if(!date) return alert('Bitte Datum wählen');
    plotEl.innerHTML = '<div style="padding:20px">Lade Daten…</div>';
    // Fetch either via TwelveData (if key provided) or CoinGecko
    let points;
    if(tdkey){
      // Twelve Data: fetch intraday series for the given interval and extract the day
      const interval = mapMinutesToTdInterval(minutes);
      points = await fetchPricesTD('max', interval, tdkey);
    } else {
      points = await fetchAllPrices();
    }
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
      <label>TwelveData API Key: <input type="text" id="td_key" placeholder="optional"></label>
      <label>Startkapital: <input type="number" id="capital" value="404"></label>
      <button class="btn" id="runstr">Run Strategy</button>
    </div>`;
  document.getElementById('runstr').onclick = async ()=>{
    plotEl.innerHTML = '<div style="padding:20px">Lade historische Daten…</div>';
    const period = document.getElementById('period').value;
    const minutes = parseInt(document.getElementById('candle').value,10)||60;
    const smaDaily = document.getElementById('smaDaily').checked;
    const capital = parseFloat(document.getElementById('capital').value)||404;

    let tdkey = document.getElementById('td_key').value.trim();
    if(!tdkey) tdkey = DEFAULT_TD_KEY;
    let points;
    if(tdkey){
      const interval = mapMinutesToTdInterval(minutes);
      points = await fetchPricesTD(period, interval, tdkey);
    } else {
      points = await fetchPrices(period);
    }

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

function renderPortfolio(){
  controls.innerHTML = `
    <div class="row">
      <label>Startdatum: <input type="date" id="pf_date"></label>
      <label>Währung: <select id="pf_currency"><option value="usd">USD</option><option value="eur">EUR</option></select></label>
      <label>Betrag (Fiat): <input type="number" id="pf_amount" value="1000"></label>
      <button class="btn" id="runpf">Run</button>
    </div>
    <div id="pf_info" style="margin-top:8px"></div>
  `;

  document.getElementById('runpf').onclick = async ()=>{
    const date = document.getElementById('pf_date').value;
    const currency = document.getElementById('pf_currency').value || 'usd';
    const amount = parseFloat(document.getElementById('pf_amount').value)||0;
    if(!date) return alert('Bitte Startdatum wählen');
    plotEl.innerHTML = '<div style="padding:20px">Lade historische Preise…</div>';

    const fromTs = Math.floor(new Date(date+'T00:00:00Z').getTime()/1000);
    const toTs = Math.floor(Date.now()/1000);
    let prices = [];
    try{
      prices = await fetchPricesRange(fromTs, toTs, currency);
    }catch(err){
      console.error(err); alert('Fehler beim Laden der Preise: '+err.message); return;
    }

    if(!prices.length){ plotEl.innerHTML = '<div style="padding:20px">Keine Preisdaten gefunden</div>'; return; }
    const daily = toDailyClose(prices);
    if(!daily.length){ plotEl.innerHTML = '<div style="padding:20px">Keine Tagesdaten gefunden</div>'; return; }

    const startPrice = daily[0][1];
    const btcAmount = amount / startPrice;
    const dates = daily.map(d=>new Date(d[0]));
    const values = daily.map(d=>btcAmount * d[1]);

    document.getElementById('pf_info').innerHTML = `<div>Startpreis: ${startPrice.toFixed(2)} ${currency.toUpperCase()} — BTC gekauft: ${btcAmount.toFixed(6)}</div>`;
    plotPortfolio(dates, values, currency);
  };
}

function plotPortfolio(dates, values, currency){
  const trace = { x: dates, y: values, type:'scatter', mode:'lines+markers', name:'Portfolio Value' };
  const layout = { title: `Portfolio Value (${currency.toUpperCase()})`, yaxis:{title:`Value (${currency.toUpperCase()})`} };
  Plotly.newPlot(plotEl, [trace], layout, {responsive:true});
}

// Fetch prices from CoinGecko for given days ('max' or number)
async function fetchPrices(days){
  // default to USD
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`);
  const j = await res.json();
  // j.prices = [[ms, price], ...]
  return j.prices.map(p=>[p[0], p[1]]);
}

// Fetch historical prices for a range (from,to in UNIX seconds) in specified currency
async function fetchPricesRange(fromSec, toSec, vs_currency='usd'){
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=${vs_currency}&from=${fromSec}&to=${toSec}`);
  const j = await res.json();
  // returns prices array [[ms, price], ...]
  return (j.prices||[]).map(p=>[p[0], p[1]]);
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
  const layout={margin:{t:30}, xaxis:{tickformat:'%Y-%m-%d', tickangle:-45}};
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

// Map minutes to Twelve Data interval strings
function mapMinutesToTdInterval(minutes){
  if(minutes<=1) return '1min';
  if(minutes<=5) return '5min';
  if(minutes<=15) return '15min';
  if(minutes<=30) return '30min';
  if(minutes<=60) return '1h';
  if(minutes<=240) return '4h';
  return '1day';
}

// Fetch via Twelve Data time_series endpoint. days can be 'max' or number of days.
async function fetchPricesTD(days, interval, apikey){
  // Twelve Data expects symbol as BTC/USD
  const symbol = 'BTC/USD';
  // outputsize: request large amount to cover the requested period; TwelveData caps apply
  const outputsize = 5000;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&format=JSON&apikey=${apikey}`;
  const res = await fetch(url);
  const j = await res.json();
  if(j.status && j.status==='error'){
    throw new Error('TwelveData error: '+(j.message||JSON.stringify(j)));
  }
  // j.values is array of {datetime, open, high, low, close, volume}
  const arr = (j.values||[]).map(v=>[new Date(v.datetime).getTime(), parseFloat(v.close)]).reverse();
  return arr;
}

function plotStrategyOHLC(daily, sma, strategy, dates){
  const x = dates;
  const priceTrace = { x, y: daily.map(d=>d[1]), type:'scatter', mode:'lines', name:'Close' };
  const smaTrace = { x, y: sma, type:'scatter', mode:'lines', name:'SMA200', line:{color:'red'} };
  const stratTrace = { x, y: strategy, type:'scatter', mode:'lines', name:'Strategy Value', yaxis:'y2', line:{color:'green'} };
  const layout = { title:'BTC SMA200 3-Day Strategy', yaxis:{title:'Price (USD)'}, yaxis2:{overlaying:'y',side:'right',title:'Strategy Value'}, xaxis:{tickformat:'%Y-%m-%d', tickangle:-45} };
  Plotly.newPlot(plotEl, [priceTrace, smaTrace, stratTrace], layout, {responsive:true});
}

function plotStrategyCandles(ohlc, sma, smaDates, strategy, candleDates){
  const candleTrace = { x: candleDates, open: ohlc.map(o=>o.open), high: ohlc.map(o=>o.high), low: ohlc.map(o=>o.low), close: ohlc.map(o=>o.close), type:'candlestick', name:'BTC' };
  const smaTrace = { x: smaDates, y: sma, type:'scatter', mode:'lines', name:'SMA200', line:{color:'red'} };
  const stratTrace = { x: candleDates, y: strategy, type:'scatter', mode:'lines', name:'Strategy Value', yaxis:'y2', line:{color:'green'} };
  const layout = { title:'BTC SMA200 3-Day Strategy', yaxis:{title:'Price (USD)'}, yaxis2:{overlaying:'y',side:'right',title:'Strategy Value'}, xaxis:{rangeslider:{visible:false}, tickformat:'%Y-%m-%d', tickangle:-45} };
  Plotly.newPlot(plotEl, [candleTrace, smaTrace, stratTrace], layout, {responsive:true});
}
