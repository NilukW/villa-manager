import React from 'react';
import { ArrowUpRight, ArrowDownRight, PieChart as PieChartIcon } from 'lucide-react';

export default function FinanceMetricsCards({ metrics }) {
    if (!metrics) return null;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
            <div className="card animate-slide-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--success)', animationDelay: '0ms' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <p style={{ color: 'var(--text-light)', margin: 0, fontWeight: 600 }}>Total Revenue</p>
                        <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '2rem', color: 'var(--text-dark)' }}>
                            LKR {(metrics.revenue || 0).toLocaleString()}
                        </h2>
                    </div>
                    <div style={{ backgroundColor: '#f0fdf4', padding: '0.75rem', borderRadius: '50%', color: 'var(--success)' }}>
                        <ArrowUpRight size={24} />
                    </div>
                </div>
                <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                    From fully settled bookings
                </p>
            </div>

            <div className="card animate-slide-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)', animationDelay: '50ms' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <p style={{ color: 'var(--text-light)', margin: 0, fontWeight: 600 }}>Total Expenses</p>
                        <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '2rem', color: 'var(--text-dark)' }}>
                            LKR {(metrics.expenses || 0).toLocaleString()}
                        </h2>
                    </div>
                    <div style={{ backgroundColor: '#fef2f2', padding: '0.75rem', borderRadius: '50%', color: 'var(--danger)' }}>
                        <ArrowDownRight size={24} />
                    </div>
                </div>
                <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                    Operational outgoings
                </p>
            </div>

            <div className="card animate-slide-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--primary)', backgroundColor: 'var(--primary)', animationDelay: '100ms' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <p style={{ color: '#e0e7ff', margin: 0, fontWeight: 600 }}>Net Profit</p>
                        <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '2rem', color: 'white' }}>
                            LKR {(metrics.profit || 0).toLocaleString()}
                        </h2>
                    </div>
                    <div style={{ backgroundColor: '#4f46e5', padding: '0.75rem', borderRadius: '50%', color: 'white' }}>
                        <PieChartIcon size={24} />
                    </div>
                </div>
                <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem', color: '#c7d2fe' }}>
                    Revenue minus Expenses
                </p>
            </div>
        </div>
    );
}
