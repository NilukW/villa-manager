import React, { useState, useEffect, useMemo } from 'react';
import { fetchWithAuth } from '../utils/api';
import { BarChart3, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Analytics() {
    const [bookings, setBookings] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [breakdownMonth, setBreakdownMonth] = useState('all'); // 'all' or month index (0-11)

    useEffect(() => {
        const fetchAnalyticsData = async () => {
            try {
                const [resRes, expRes] = await Promise.all([
                    fetchWithAuth('/api/reservations'),
                    fetchWithAuth('/api/expenses')
                ]);
                const bs = await resRes.json();
                const es = await expRes.json();

                setBookings(bs.data || []);
                setExpenses(es.data || []);
            } catch (err) {
                console.error("Failed to load analytics data", err);
            } finally {
                setLoading(false);
            }
        };

        fetchAnalyticsData();
    }, []);

    // Extract available years from data to populate filter dropdown
    const availableYears = useMemo(() => {
        const years = new Set([new Date().getFullYear()]);
        
        // Group reservations to calculate their settlement dates first
        const groups = {};
        bookings.forEach(b => {
            const gid = b.groupId || b.id;
            if (!groups[gid]) {
                groups[gid] = { ...b, totalAmount: 0, roomNamesList: [] };
            }
            groups[gid].roomNamesList.push(b.roomName);
        });

        Object.values(groups).forEach(g => {
            let settlementDate = g.checkOutDate;
            try {
                if (g.advancedPayments) {
                    const parsed = JSON.parse(g.advancedPayments);
                    if (parsed.length > 0) {
                        settlementDate = parsed[parsed.length - 1].date || g.checkOutDate;
                    }
                }
            } catch (e) {}
            if (settlementDate) {
                const yr = new Date(settlementDate).getFullYear();
                if (!isNaN(yr)) years.add(yr);
            }
        });

        expenses.forEach(e => {
            if (e.date) {
                const yr = new Date(e.date).getFullYear();
                if (!isNaN(yr)) years.add(yr);
            }
        });

        return Array.from(years).sort((a, b) => b - a);
    }, [bookings, expenses]);

    // Perform monthly groupings based on selected year
    const monthlyData = useMemo(() => {
        const monthlyRevenue = Array(12).fill(0);
        const monthlyExpenses = Array(12).fill(0);
        
        // Structure: monthlyCategoryTotals[monthIndex] = { CategoryName: TotalLkr }
        const monthlyCategoryTotals = Array(12).fill(null).map(() => ({
            Maintenance: 0, Cleaning: 0, Utilities: 0, Salary: 0, Supplies: 0, Other: 0
        }));

        const yearlyCategoryTotals = {
            Maintenance: 0, Cleaning: 0, Utilities: 0, Salary: 0, Supplies: 0, Other: 0
        };

        // 1. Calculate Booking Revenues
        const groups = {};
        bookings.forEach(b => {
            const gid = b.groupId || b.id;
            if (!groups[gid]) {
                groups[gid] = { ...b, totalAmount: 0, advancedAmount: 0, roomNamesList: [] };
            }
            groups[gid].totalAmount += Number(b.totalAmount || 0);
            groups[gid].advancedAmount += Number(b.advancedAmount || 0);
            groups[gid].roomNamesList.push(b.roomName);
        });

        Object.values(groups).forEach(g => {
            let paid = g.advancedAmount || 0;
            let settlementDate = g.checkOutDate;
            try {
                if (g.advancedPayments) {
                    const parsed = JSON.parse(g.advancedPayments);
                    if (parsed.length > 0) {
                        paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0) * g.roomNamesList.length;
                        settlementDate = parsed[parsed.length - 1].date || g.checkOutDate;
                    }
                }
            } catch(e) {}

            const pending = Number(g.totalAmount || 0) - paid;
            if (pending <= 0.05 && settlementDate) {
                const sDate = new Date(settlementDate);
                const sYear = sDate.getFullYear();
                if (sYear === Number(selectedYear)) {
                    const sMonth = sDate.getMonth(); // 0-11
                    monthlyRevenue[sMonth] += g.totalAmount;
                }
            }
        });

        // 2. Calculate Expenses & Category Distribution
        expenses.forEach(e => {
            if (e.date) {
                const eDate = new Date(e.date);
                const eYear = eDate.getFullYear();
                if (eYear === Number(selectedYear)) {
                    const eMonth = eDate.getMonth();
                    const amount = Number(e.amount || 0);
                    
                    monthlyExpenses[eMonth] += amount;

                    // Group by categories
                    const cat = e.category || 'Other';
                    const mappedCat = yearlyCategoryTotals.hasOwnProperty(cat) ? cat : 'Other';
                    
                    monthlyCategoryTotals[eMonth][mappedCat] += amount;
                    yearlyCategoryTotals[mappedCat] += amount;
                }
            }
        });

        // Calculate card aggregates
        const totalYearlyRevenue = monthlyRevenue.reduce((sum, val) => sum + val, 0);
        const totalYearlyExpenses = monthlyExpenses.reduce((sum, val) => sum + val, 0);

        return {
            monthlyRevenue,
            monthlyExpenses,
            monthlyCategoryTotals,
            yearlyCategoryTotals,
            yearlyRevenue: totalYearlyRevenue,
            yearlyExpenses: totalYearlyExpenses,
            yearlyProfit: totalYearlyRevenue - totalYearlyExpenses
        };
    }, [bookings, expenses, selectedYear]);

    // Category breakdown filtered by breakdownMonth state
    const currentCategoryBreakdown = useMemo(() => {
        const totals = breakdownMonth === 'all' 
            ? monthlyData.yearlyCategoryTotals 
            : monthlyData.monthlyCategoryTotals[breakdownMonth];
        
        const sum = Object.values(totals).reduce((a, b) => a + b, 0);
        
        return Object.keys(totals).map(cat => ({
            name: cat,
            value: totals[cat],
            percentage: sum > 0 ? Math.round((totals[cat] / sum) * 100) : 0
        })).sort((a, b) => b.value - a.value);
    }, [monthlyData, breakdownMonth]);

    // SVG Bar Chart Dimensions & Calculations
    const svgChart = useMemo(() => {
        const width = 780;
        const height = 300;
        const paddingLeft = 60;
        const paddingBottom = 40;
        const paddingTop = 20;
        const paddingRight = 20;

        const maxVal = Math.max(
            ...monthlyData.monthlyRevenue, 
            ...monthlyData.monthlyExpenses,
            50000 // default minimum ceiling
        );

        // Round maxVal to a clean metric (e.g. multiples of 10k or 50k)
        const roundTo = maxVal > 500000 ? 100000 : 20000;
        const yAxisMax = Math.ceil(maxVal / roundTo) * roundTo;

        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        const gridLines = [];
        for (let i = 0; i <= 4; i++) {
            const ratio = i / 4;
            const y = height - paddingBottom - ratio * chartHeight;
            const val = ratio * yAxisMax;
            gridLines.push({ y, label: val.toLocaleString() });
        }

        const barWidth = 14;
        const monthGroupWidth = chartWidth / 12;

        const bars = [];
        for (let i = 0; i < 12; i++) {
            const rev = monthlyData.monthlyRevenue[i];
            const exp = monthlyData.monthlyExpenses[i];

            const revHeight = (rev / yAxisMax) * chartHeight;
            const expHeight = (exp / yAxisMax) * chartHeight;

            const groupCenterX = paddingLeft + (i * monthGroupWidth) + (monthGroupWidth / 2);
            
            // Positions: Revenue bar left of center, Expense bar right of center
            const revX = groupCenterX - barWidth - 2;
            const expX = groupCenterX + 2;

            const revY = height - paddingBottom - revHeight;
            const expY = height - paddingBottom - expHeight;

            bars.push({
                month: MONTH_SHORT[i],
                monthFullName: MONTH_NAMES[i],
                xLabel: groupCenterX,
                rev: { x: revX, y: revY, h: revHeight, val: rev },
                exp: { x: expX, y: expY, h: expHeight, val: exp }
            });
        }

        return { width, height, gridLines, bars, paddingLeft, paddingBottom, chartWidth };
    }, [monthlyData]);

    if (loading) return <div style={{ padding: '2rem' }}>Loading Financial Analytics...</div>;

    return (
        <div className="animate-slide-up">
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <div>
                    <h1 className="page-title">Financial Analytics</h1>
                    <p style={{ color: 'var(--text-light)', margin: '0.25rem 0 0 0', fontSize: '0.95rem' }}>
                        Visualizing monthly income, operational expenses, and profit margins.
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.9rem' }}>Report Year:</span>
                    <select
                        className="form-control"
                        value={selectedYear}
                        onChange={e => {
                            setSelectedYear(Number(e.target.value));
                            setBreakdownMonth('all'); // reset monthly category focus
                        }}
                        style={{ padding: '0.5rem 2rem 0.5rem 1rem', width: 'auto', fontWeight: 600 }}
                    >
                        {availableYears.map(yr => (
                            <option key={yr} value={yr}>{yr}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Performance Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                {/* Revenue Card */}
                <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--success)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: 'var(--text-light)', margin: 0, fontWeight: 600 }}>Yearly Revenue</p>
                            <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '1.85rem', color: 'var(--text-dark)' }}>
                                LKR {monthlyData.yearlyRevenue.toLocaleString()}
                            </h2>
                        </div>
                        <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem', borderRadius: '50%', color: 'var(--success)' }}>
                            <TrendingUp size={20} />
                        </div>
                    </div>
                </div>

                {/* Expenses Card */}
                <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: 'var(--text-light)', margin: 0, fontWeight: 600 }}>Yearly Expenses</p>
                            <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '1.85rem', color: 'var(--text-dark)' }}>
                                LKR {monthlyData.yearlyExpenses.toLocaleString()}
                            </h2>
                        </div>
                        <div style={{ backgroundColor: '#fef2f2', padding: '0.6rem', borderRadius: '50%', color: 'var(--danger)' }}>
                            <TrendingDown size={20} />
                        </div>
                    </div>
                </div>

                {/* Profit Card */}
                <div className="card" style={{ 
                    padding: '1.5rem', 
                    borderLeft: '4px solid var(--primary)', 
                    backgroundColor: 'var(--primary)' 
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: '#e0e7ff', margin: 0, fontWeight: 600 }}>Yearly Net Profit</p>
                            <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '1.85rem', color: 'white' }}>
                                LKR {monthlyData.yearlyProfit.toLocaleString()}
                            </h2>
                        </div>
                        <div style={{ backgroundColor: '#4f46e5', padding: '0.6rem', borderRadius: '50%', color: 'white', border: '1px solid #c7d2fe' }}>
                            <DollarSign size={20} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Chart & Distribution Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
                {/* SVG Chart Card */}
                <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: 0, color: 'var(--text-dark)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                        <BarChart3 size={20} className="text-primary" />
                        Income vs Expenses Comparison ({selectedYear})
                    </h3>

                    {/* SVG Render */}
                    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
                        <svg 
                            viewBox={`0 0 ${svgChart.width} ${svgChart.height}`} 
                            style={{ width: '100%', height: 'auto', minWidth: '680px' }}
                        >
                            {/* Gridlines & Y-axis Labels */}
                            {svgChart.gridLines.map((line, i) => (
                                <g key={i}>
                                    <text 
                                        x={svgChart.paddingLeft - 10} 
                                        y={line.y + 4} 
                                        textAnchor="end" 
                                        style={{ fontSize: '0.75rem', fill: 'var(--text-light)', fontFamily: 'inherit' }}
                                    >
                                        {line.label}
                                    </text>
                                    <line 
                                        x1={svgChart.paddingLeft} 
                                        y1={line.y} 
                                        x2={svgChart.width - 20} 
                                        y2={line.y} 
                                        stroke="var(--border)" 
                                        strokeDasharray={i === 0 ? '0' : '4 4'}
                                        strokeWidth="1" 
                                    />
                                </g>
                            ))}

                            {/* Monthly Data Bars */}
                            {svgChart.bars.map((bar, i) => (
                                <g key={i}>
                                    {/* Revenue Bar */}
                                    {bar.rev.h > 0 && (
                                        <rect
                                            x={bar.rev.x}
                                            y={bar.rev.y}
                                            width={14}
                                            height={bar.rev.h}
                                            fill="var(--success)"
                                            rx={3}
                                            style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
                                            onMouseEnter={(e) => e.target.setAttribute('fill', '#059669')}
                                            onMouseLeave={(e) => e.target.setAttribute('fill', 'var(--success)')}
                                        >
                                            <title>{bar.monthFullName}: Revenue LKR {bar.rev.val.toLocaleString()}</title>
                                        </rect>
                                    )}

                                    {/* Expense Bar */}
                                    {bar.exp.h > 0 && (
                                        <rect
                                            x={bar.exp.x}
                                            y={bar.exp.y}
                                            width={14}
                                            height={bar.exp.h}
                                            fill="var(--danger)"
                                            rx={3}
                                            style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
                                            onMouseEnter={(e) => e.target.setAttribute('fill', '#dc2626')}
                                            onMouseLeave={(e) => e.target.setAttribute('fill', 'var(--danger)')}
                                        >
                                            <title>{bar.monthFullName}: Expense LKR {bar.exp.val.toLocaleString()}</title>
                                        </rect>
                                    )}

                                    {/* X-axis Labels */}
                                    <text
                                        x={bar.xLabel}
                                        y={svgChart.height - svgChart.paddingBottom + 20}
                                        textAnchor="middle"
                                        style={{ fontSize: '0.8rem', fontWeight: 500, fill: 'var(--text-light)', fontFamily: 'inherit' }}
                                    >
                                        {bar.month}
                                    </text>
                                </g>
                            ))}
                        </svg>
                    </div>

                    {/* Chart Legend */}
                    <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--success)' }}></div>
                            <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Income / Revenue</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--danger)' }}></div>
                            <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>Expenses</span>
                        </div>
                    </div>
                </div>

                {/* Expense Breakdown Card */}
                <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-dark)', fontSize: '1.15rem' }}>Expense Breakdown</h3>
                        <select
                            className="form-control"
                            value={breakdownMonth}
                            onChange={e => setBreakdownMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                            style={{ padding: '0.3rem 1.5rem 0.3rem 0.5rem', width: 'auto', fontSize: '0.8rem', fontWeight: 600 }}
                        >
                            <option value="all">Full Year</option>
                            {MONTH_NAMES.map((m, idx) => (
                                <option key={idx} value={idx}>{m}</option>
                            ))}
                        </select>
                    </div>

                    {/* Progress bars list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', flex: 1, justifyContent: 'center' }}>
                        {currentCategoryBreakdown.length === 0 || currentCategoryBreakdown.every(c => c.value === 0) ? (
                            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                No expenses logged for this period.
                            </div>
                        ) : (
                            currentCategoryBreakdown.map((cat, idx) => (
                                <div key={idx}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 500 }}>
                                        <span style={{ color: 'var(--text)' }}>{cat.name}</span>
                                        <span style={{ color: 'var(--text-light)' }}>
                                            LKR {cat.value.toLocaleString()} ({cat.percentage}%)
                                        </span>
                                    </div>
                                    <div style={{ width: '100%', height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                                        <div 
                                            style={{ 
                                                width: `${cat.percentage}%`, 
                                                height: '100%', 
                                                backgroundColor: idx === 0 ? 'var(--primary)' : (idx === 1 ? '#8b5cf6' : '#ec4899'),
                                                backgroundImage: idx > 2 ? 'linear-gradient(to right, #64748b, #94a3b8)' : 'none',
                                                borderRadius: '4px',
                                                transition: 'width 0.4s ease-out'
                                            }}
                                        ></div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Monthly Summary Ledger Card */}
            <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc' }}>
                    <h3 style={{ margin: 0, color: 'var(--text-dark)', fontSize: '1.15rem' }}>Monthly Performance Summary Table</h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                <th style={{ padding: '1rem', fontWeight: 600 }}>Month</th>
                                <th style={{ padding: '1rem', fontWeight: 600 }}>Revenue (LKR)</th>
                                <th style={{ padding: '1rem', fontWeight: 600 }}>Expenses (LKR)</th>
                                <th style={{ padding: '1rem', fontWeight: 600 }}>Net Profit (LKR)</th>
                                <th style={{ padding: '1rem', fontWeight: 600 }}>Profit Margin</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MONTH_NAMES.map((month, idx) => {
                                const rev = monthlyData.monthlyRevenue[idx];
                                const exp = monthlyData.monthlyExpenses[idx];
                                const profit = rev - exp;
                                const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;

                                return (
                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.95rem' }}>
                                        <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text)' }}>{month}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: rev > 0 ? 'var(--text)' : 'var(--text-light)' }}>
                                            {rev > 0 ? rev.toLocaleString() : '-'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: exp > 0 ? 'var(--text)' : 'var(--text-light)' }}>
                                            {exp > 0 ? exp.toLocaleString() : '-'}
                                        </td>
                                        <td style={{ 
                                            padding: '0.85rem 1rem', 
                                            fontWeight: 600, 
                                            color: profit > 0 ? 'var(--success)' : (profit < 0 ? 'var(--danger)' : 'var(--text-light)') 
                                        }}>
                                            {profit !== 0 ? profit.toLocaleString() : '-'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            {rev > 0 ? (
                                                <span style={{ 
                                                    padding: '0.2rem 0.5rem', 
                                                    borderRadius: '4px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 600,
                                                    backgroundColor: profit > 0 ? '#e6f4ea' : '#fce8e6',
                                                    color: profit > 0 ? '#137333' : '#c5221f'
                                                }}>
                                                    {margin}%
                                                </span>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                            
                            {/* Totals Row */}
                            <tr style={{ backgroundColor: '#f8fafc', fontWeight: 700, borderTop: '2px solid var(--border)', fontSize: '0.95rem' }}>
                                <td style={{ padding: '1rem' }}>Yearly Totals</td>
                                <td style={{ padding: '1rem', color: 'var(--success)' }}>
                                    LKR {monthlyData.yearlyRevenue.toLocaleString()}
                                </td>
                                <td style={{ padding: '1rem', color: 'var(--danger)' }}>
                                    LKR {monthlyData.yearlyExpenses.toLocaleString()}
                                </td>
                                <td style={{ 
                                    padding: '1rem', 
                                    color: monthlyData.yearlyProfit > 0 ? 'var(--success)' : (monthlyData.yearlyProfit < 0 ? 'var(--danger)' : 'var(--text)') 
                                }}>
                                    LKR {monthlyData.yearlyProfit.toLocaleString()}
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    {monthlyData.yearlyRevenue > 0 ? (
                                        <span style={{ 
                                            padding: '0.2rem 0.5rem', 
                                            borderRadius: '4px',
                                            fontSize: '0.8rem',
                                            fontWeight: 700,
                                            backgroundColor: monthlyData.yearlyProfit > 0 ? '#e6f4ea' : '#fce8e6',
                                            color: monthlyData.yearlyProfit > 0 ? '#137333' : '#c5221f'
                                        }}>
                                            {Math.round((monthlyData.yearlyProfit / monthlyData.yearlyRevenue) * 100)}%
                                        </span>
                                    ) : '-'}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
