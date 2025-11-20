import sys
import pandas as pd
import yfinance as yf

def run_btc_sma200_3days(ticker='BTC-USD', years=15, initial_investment=404):
    """Fetch historical data for `ticker`, compute SMA200 and simulate the
    3-day-above / 3-day-below SMA200 strategy. Returns the dataframe.
    """
    # Prepare date range
    end_date = pd.to_datetime("today")
    start_date = (end_date - pd.DateOffset(years=years)).strftime('%Y-%m-%d')
    end_date = end_date.strftime('%Y-%m-%d')

    # Download OHLC data via yfinance
    print(f"Downloading {ticker} from {start_date} to {end_date}...")
    t = yf.Ticker(ticker)
    hist = t.history(start=start_date, end=end_date, interval='1d')
    if hist.empty:
        raise RuntimeError('No historical data returned for ticker: ' + ticker)

    # SMA200
    hist['SMA200'] = hist['Close'].rolling(window=200).mean()

    # Strategy simulation variables
    investment_value_strategy = initial_investment
    position_opened = False
    consecutive_days_above = 0
    consecutive_days_below = 0
    values_strategy = [initial_investment]

    # Iterate from the second row (index 1) to compute daily returns
    for i in range(1, len(hist)):
        close_price = hist['Close'].iloc[i]
        sma200 = hist['SMA200'].iloc[i]

        # Count consecutive days above/below SMA200 (skip NaN SMA values)
        if pd.notna(sma200) and close_price > sma200:
            consecutive_days_above += 1
            consecutive_days_below = 0
        else:
            consecutive_days_below += 1
            consecutive_days_above = 0

        # Open position after 3 consecutive days above SMA200
        if consecutive_days_above >= 3 and not position_opened:
            position_opened = True
            entry_price = close_price

        # Close position after 3 consecutive days below SMA200
        if consecutive_days_below >= 3 and position_opened:
            position_opened = False

        # If position open, grow investment by daily return
        if position_opened:
            prev_close = hist['Close'].iloc[i-1]
            daily_return = (close_price / prev_close) - 1
            investment_value_strategy = investment_value_strategy * (1 + daily_return)

        values_strategy.append(investment_value_strategy)

    # Attach strategy values to dataframe (align length)
    hist = hist.assign(StrategyValue=values_strategy)
    return hist


def plot_with_plotly(hist, title=None):
    try:
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots
    except Exception as e:
        raise

    title = title or 'BTC-USD SMA200 3-day Strategy'
    fig = make_subplots(specs=[[{"secondary_y": False}]])

    # Candlestick
    fig.add_trace(go.Candlestick(
        x=hist.index,
        open=hist['Open'],
        high=hist['High'],
        low=hist['Low'],
        close=hist['Close'],
        name='BTC (Candlestick)'
    ))

    # SMA200
    fig.add_trace(go.Scatter(
        x=hist.index,
        y=hist['SMA200'],
        marker_color='red',
        name='SMA 200',
        line=dict(width=2)
    ))

    # Strategy Value
    fig.add_trace(go.Scatter(
        x=hist.index,
        y=hist['StrategyValue'],
        marker_color='green',
        name='Strategy Value',
        line=dict(width=2),
        yaxis='y2'
    ))

    # Update layout with a second y-axis for strategy value
    fig.update_layout(
        title={'text': title, 'x': 0.5},
        plot_bgcolor='white',
        paper_bgcolor='white',
        font=dict(color='black'),
        xaxis_rangeslider_visible=True,
        legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='right', x=1)
    )

    # Add secondary y-axis for StrategyValue on right
    fig.update_yaxes(showgrid=True, color='black', title_text='Price (USD)')
    fig.update_layout(yaxis2=dict(overlaying='y', side='right', title='Strategy Value'))

    # Rangebreaks to skip weekends (if desired)
    try:
        fig.update_xaxes(rangebreaks=[dict(bounds=["sat", "mon"])])
    except Exception:
        pass

    fig.show()


def main():
    # Default run: last 15 years (BTC has less history than equities but this is safe)
    try:
        hist = run_btc_sma200_3days(ticker='BTC-USD', years=15, initial_investment=404)
    except Exception as e:
        print('Error fetching data or running strategy:', e)
        sys.exit(1)

    # Try plotting with Plotly, otherwise save CSV and notify
    try:
        plot_with_plotly(hist, title='BTC-USD, SMA200, 3-Day Strategy')
    except Exception as e:
        out_csv = 'btc_sma200_strategy.csv'
        hist.to_csv(out_csv)
        print('Plotly not available or plotting failed. Data saved to', out_csv)


if __name__ == '__main__':
    main()
