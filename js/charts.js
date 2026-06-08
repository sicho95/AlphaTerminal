/**
 * AlphaTerminal Charts Utility
 * Wrapper for Chart.js
 */

export const ChartUtils = {
    // Colors based on Design System
    colors: {
        primary: '#041627',
        secondary: '#3b6934',
        error: '#ba1a1a',
        outline: '#c4c6cd',
        chart: [
            '#041627', '#3b6934', '#ba1a1a', '#0061a4', '#6b5e00', '#7e5260'
        ]
    },

    initDonut(ctx, data, labels) {
        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: this.colors.chart,
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: { size: 12, family: 'Inter' }
                        }
                    }
                }
            }
        });
    },

    initLine(ctx, data, labels, label = 'Valeur') {
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
                    borderColor: this.colors.primary,
                    backgroundColor: 'rgba(4, 22, 39, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { display: false },
                    y: {
                        display: true,
                        grid: { color: '#f0f0f0' },
                        ticks: { font: { size: 10 } }
                    }
                }
            }
        });
    },

    initBarCompare(ctx, actualData, targetData, labels) {
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Actuel',
                        data: actualData,
                        backgroundColor: this.colors.primary,
                        borderRadius: 4
                    },
                    {
                        label: 'Cible',
                        data: targetData,
                        backgroundColor: this.colors.outline,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { callback: value => value + '%' }
                    }
                }
            }
        });
    }
};
