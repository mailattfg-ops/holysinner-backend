// "₹1,23,456" for messages and audit details (Indian digit grouping).
export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`
