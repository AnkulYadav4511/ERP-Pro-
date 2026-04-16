// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
// const mongoose = require('mongoose');
// const cors = require('cors');
// require('dotenv').config();
// const ExcelJS = require('exceljs');

// const User = require('./models/User');
// const Shift = require('./models/Shift');
// const Note = require('./models/Note');

// const app = express();
// const server = http.createServer(app); // ✅ Wrap express in http server

// // ✅ Socket.IO setup
// const io = new Server(server, {
//     cors: { origin: '*', methods: ['GET', 'POST'] }
// });

// app.use(cors());
// app.use(express.json({ limit: '50mb' }));

// mongoose.connect('mongodb://127.0.0.1:27017/tracking')
//     .then(() => console.log("✅ Connected to Local MongoDB"))
//     .catch((err) => console.error("❌ MongoDB connection error:", err));

// const cleanId = (id) => {
//     if (!id) return null;
//     const cleaned = id.toString().replace(/['"]+/g, '').trim();
//     if (!mongoose.Types.ObjectId.isValid(cleaned)) return null;
//     return new mongoose.Types.ObjectId(cleaned);
// };

// // ─────────────────────────────────────────────
// //         SOCKET.IO — REAL TIME TRACKING
// // ─────────────────────────────────────────────
// io.on('connection', (socket) => {
//     console.log('🔌 Socket connected:', socket.id);

//     // Admin joins a room to watch a specific shift
//     socket.on('watch_shift', ({ shiftId }) => {
//         socket.join(`shift_${shiftId}`);
//         console.log(`👁️ Admin watching shift: ${shiftId}`);
//     });

//     // Worker sends live location
//     socket.on('location_update', async ({ userId, latitude, longitude, shiftId }) => {
//         try {
//             const lat = parseFloat(latitude);
//             const lng = parseFloat(longitude);
//             if (isNaN(lat) || isNaN(lng)) return;

//             const uid = cleanId(userId);

//             // Save to DB
//             const shift = await Shift.findOneAndUpdate(
//                 { userId: uid, logoutTime: 'Ongoing' },
//                 { $push: { path: { latitude: lat, longitude: lng, timestamp: new Date() } } },
//                 { new: true }
//             );

//             if (!shift) return;

//             // ✅ Broadcast instantly to admin watching this shift
//             io.to(`shift_${shift._id.toString()}`).emit('location_updated', {
//                 latitude: lat,
//                 longitude: lng,
//                 shiftId: shift._id.toString(),
//                 totalPoints: shift.path.length,
//             });

//             console.log(`📍 Live [${lat}, ${lng}] → shift_${shift._id}`);
//         } catch (err) {
//             console.error('Socket location_update error:', err.message);
//         }
//     });

//     socket.on('disconnect', () => {
//         console.log('❌ Socket disconnected:', socket.id);
//     });
// });

// // ─────────────────────────────────────────────
// //              AUTH ROUTES
// // ─────────────────────────────────────────────

// app.get('/api/auth/profile/:userId', async (req, res) => {
//     try {
//         const { userId } = req.params;
//         const id = userId.replace(/['"]+/g, '').trim();
//         if (!mongoose.Types.ObjectId.isValid(id))
//             return res.status(400).json({ message: "Invalid ID format" });
//         const user = await User.findById(id).select('-password');
//         if (!user) return res.status(404).json({ message: "User not found" });
//         const userObj = user.toObject();
//         if (user.profileImage && user.profileImage.data)
//             userObj.profileImage.data = user.profileImage.data.toString('base64');
//         res.json(userObj);
//     } catch (error) {
//         res.status(500).json({ message: "Internal Server Error" });
//     }
// });

// app.post('/api/auth/login', async (req, res) => {
//     try {
//         const { email, password } = req.body;
//         const user = await User.findOne({ email, password });
//         if (!user) return res.status(400).json({ message: "Invalid credentials" });
//         const activeShift = await Shift.findOne({ userId: user._id, logoutTime: 'Ongoing' });
//         res.json({
//             userId: user._id.toString(),
//             name: user.name,
//             role: user.role,
//             isShiftActive: !!activeShift,
//         });
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// app.post('/api/auth/signup', async (req, res) => {
//     try {
//         const { name, email, password, profileImage, role, adminKey } = req.body;
//         const existingUser = await User.findOne({ email });
//         if (existingUser) return res.status(400).json({ message: "Email already in use" });
//         let finalRole = 'worker';
//         if (role === 'admin') {
//             if (adminKey !== "admin")
//                 return res.status(403).json({ message: "Invalid Admin Key." });
//             finalRole = 'admin';
//         }
//         const newUser = new User({ name, email, password, role: finalRole });
//         if (profileImage) {
//             newUser.profileImage = {
//                 data: Buffer.from(profileImage, 'base64'),
//                 contentType: 'image/jpeg'
//             };
//         }
//         await newUser.save();
//         res.status(201).json({ userId: newUser._id });
//     } catch (e) {
//         res.status(500).json({ message: "Signup failed: " + e.message });
//     }
// });

// // ─────────────────────────────────────────────
// //              SHIFT ROUTES
// // ─────────────────────────────────────────────

// app.post('/api/shift/start', async (req, res) => {
//     try {
//         const userId = cleanId(req.body.userId);
//         const existing = await Shift.findOne({ userId, logoutTime: 'Ongoing' });
//         if (existing) return res.status(200).json({ startTime: existing.startTime, shiftId: existing._id });
//         const shift = await Shift.create({
//             userId,
//             startTime: new Date(),
//             date: new Date().toLocaleDateString('en-IN'),
//             logoutTime: 'Ongoing',
//             path: [],
//             notes: []
//         });
//         await User.findByIdAndUpdate(userId, { isShiftActive: true });
//         // ✅ Return shiftId so worker can use it for socket
//         res.status(201).json({ startTime: shift.startTime, shiftId: shift._id });
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// app.post('/api/shift/end', async (req, res) => {
//     try {
//         const userId = cleanId(req.body.userId);
//         const now = new Date();
//         const logoutTimeStr = now.toLocaleTimeString('en-IN', {
//             hour: '2-digit', minute: '2-digit', hour12: false
//         });
//         const shift = await Shift.findOneAndUpdate(
//             { userId, logoutTime: 'Ongoing' },
//             { endTime: now, logoutTime: logoutTimeStr },
//             { new: true }
//         );
//         await User.findByIdAndUpdate(userId, { isShiftActive: false });
//         if (!shift) return res.status(200).json({ message: "Already ended" });
//         res.json({
//             message: "Shift ended",
//             summary: { pointsTracked: shift.path.length, notesCaptured: shift.notes.length }
//         });
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// app.get('/api/shift/active/:userId', async (req, res) => {
//     try {
//         const userId = cleanId(req.params.userId);
//         const shift = await Shift.findOne({ userId, logoutTime: 'Ongoing' }).lean();
//         if (!shift) return res.status(404).json({ message: "No active shift" });
//         res.json(shift);
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// app.get('/api/shift-details/:shiftId', async (req, res) => {
//     try {
//         const shift = await Shift.findById(req.params.shiftId).populate('notes').lean();
//         if (!shift) return res.status(404).json({ message: "Shift not found" });
//         res.status(200).json({ date: shift.date, path: shift.path || [], notes: shift.notes || [] });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// // ─────────────────────────────────────────────
// //    TRACKING ROUTE (kept for backup/fallback)
// // ─────────────────────────────────────────────

// app.post('/api/track', async (req, res) => {
//     try {
//         const userId = cleanId(req.body.userId);
//         if (!userId) return res.status(400).json({ message: "Invalid userId" });
//         const lat = parseFloat(req.body.latitude);
//         const lng = parseFloat(req.body.longitude);
//         if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ message: "Invalid coordinates" });
//         const shift = await Shift.findOneAndUpdate(
//             { userId, logoutTime: 'Ongoing' },
//             { $push: { path: { latitude: lat, longitude: lng, timestamp: new Date() } } },
//             { new: true }
//         );
//         if (!shift) return res.status(404).json({ message: "No active shift" });

//         // ✅ Also broadcast via socket when REST is used
//         io.to(`shift_${shift._id.toString()}`).emit('location_updated', {
//             latitude: lat, longitude: lng,
//             shiftId: shift._id.toString(),
//             totalPoints: shift.path.length,
//         });

//         res.status(200).json({ count: shift.path.length });
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// // ─────────────────────────────────────────────
// //              NOTES ROUTE
// // ─────────────────────────────────────────────

// app.post('/api/notes', async (req, res) => {
//     try {
//         const { userId, className, directorName, directorNumber, address,
//             contactPersonName, contactPersonNumber, studentCount, classCount,
//             latitude, longitude } = req.body;
//         const newNote = new Note({
//             userId, className, directorName, directorNumber, address,
//             contactPersonName, contactPersonNumber, studentCount, classCount,
//             latitude, longitude
//         });
//         await newNote.save();
//         const shift = await Shift.findOneAndUpdate(
//             { userId, logoutTime: 'Ongoing' },
//             { $push: { notes: newNote._id } },
//             { new: true }
//         );
//         if (!shift) return res.status(404).json({ message: "No active shift found" });
//         res.status(201).json({ message: "Note recorded and linked to shift" });
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// // ─────────────────────────────────────────────
// //              HISTORY ROUTE
// // ─────────────────────────────────────────────

// app.get('/api/history/:userId', async (req, res) => {
//     try {
//         const userId = cleanId(req.params.userId);
//         if (!userId) return res.status(400).json({ message: "Invalid User ID format" });
//         const archivedShifts = await Shift.find({ userId }).sort({ createdAt: -1 }).populate('notes');
//         const historyLog = archivedShifts.map(s => ({
//             _id: s._id,
//             date: s.date,
//             loginTime: s.startTime ? new Date(s.startTime).toLocaleTimeString() : "N/A",
//             logoutTime: s.logoutTime === 'Ongoing'
//                 ? 'Ongoing'
//                 : (s.endTime ? new Date(s.endTime).toLocaleTimeString() : "N/A"),
//             path: s.path || [],
//             dayNotes: s.notes || []
//         }));
//         res.status(200).json(historyLog);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// // ─────────────────────────────────────────────
// //              ADMIN ROUTES
// // ─────────────────────────────────────────────

// app.get('/api/admin/ongoing-shifts', async (req, res) => {
//     try {
//         const shifts = await Shift.find({ logoutTime: 'Ongoing' })
//             .populate('userId', 'name profileImage')
//             .sort({ startTime: -1 });
//         res.json(shifts);
//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// app.get('/api/admin/shift/:id', async (req, res) => {
//     try {
//         const shift = await Shift.findById(req.params.id);
//         res.json(shift);
//     } catch (err) {
//         res.status(500).json({ message: "Error fetching path" });
//     }
// });

// app.get('/api/admin/all-workers', async (req, res) => {
//     try {
//         const workers = await User.find({ role: 'worker' })
//             .select('name email profileImage role').sort({ name: 1 });
//         const formattedWorkers = workers.map(worker => {
//             const workerObj = worker.toObject();
//             if (worker.profileImage && worker.profileImage.data) {
//                 workerObj.profileImage = `data:${worker.profileImage.contentType};base64,`
//                     + worker.profileImage.data.toString('base64');
//             }
//             return workerObj;
//         });
//         res.status(200).json(formattedWorkers);
//     } catch (err) {
//         res.status(500).json({ message: "Error formatting worker data" });
//     }
// });

// // ─────────────────────────────────────────────
// //         EXCEL EXPORT ROUTES
// // ─────────────────────────────────────────────

// app.get('/api/export-monthly-notes', async (req, res) => {
//     try {
//         const { month, year } = req.query;
//         const datePattern = new RegExp(`\\/${month}\\/${year}$`);
//         const shifts = await Shift.find({ date: { $regex: datePattern } })
//             .populate('notes').populate('userId', 'name');
//         const workbook = new ExcelJS.Workbook();
//         const ws = workbook.addWorksheet('Monthly Report');
//         ws.columns = [
//             { key: 'date', width: 14 }, { key: 'className', width: 20 },
//             { key: 'subjects', width: 28 }, { key: 'director', width: 18 },
//             { key: 'phone', width: 15 }, { key: 'address', width: 38 },
//             { key: 'studentCount', width: 12 }, { key: 'classCount', width: 12 },
//             { key: 'remark', width: 20 },
//         ];
//         ws.mergeCells('A1:I1');
//         const titleCell = ws.getCell('A1');
//         titleCell.value = `Monthly Report - ${month}/${year}`;
//         titleCell.font = { bold: true, size: 13 };
//         titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
//         titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
//         ws.getRow(1).height = 25;
//         const headerRow = ws.addRow(['Date', 'Class Name', 'Subjects Taught', 'Director',
//             'Phone', 'Address', 'Student Count', 'Class Count', 'Remark']);
//         headerRow.eachCell(cell => {
//             cell.font = { bold: true, size: 11 };
//             cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
//             cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
//             cell.alignment = { wrapText: true, vertical: 'middle' };
//         });
//         headerRow.height = 30;
//         shifts.forEach(shift => {
//             if (shift.notes?.length > 0) {
//                 shift.notes.forEach(note => {
//                     const row = ws.addRow([shift.date, note.className || '', note.contactPersonName || '',
//                     note.directorName || '', note.directorNumber || '', note.address || '',
//                     note.studentCount ?? 0, note.classCount ?? 0, '']);
//                     row.eachCell(cell => {
//                         cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
//                         cell.alignment = { wrapText: true, vertical: 'top' };
//                     });
//                 });
//             }
//         });
//         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         res.setHeader('Content-Disposition', `attachment; filename="Report_${month}_${year}.xlsx"`);
//         await workbook.xlsx.write(res);
//         res.end();
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// });

// app.get('/api/download-shift-report/:shiftId', async (req, res) => {
//     try {
//         const shift = await Shift.findById(req.params.shiftId).populate('notes').populate('userId', 'name');
//         if (!shift) return res.status(404).json({ message: "Shift not found" });
//         const workerName = shift.userId?.name || 'Worker';
//         const workbook = new ExcelJS.Workbook();
//         const ws = workbook.addWorksheet('Report');
//         ws.columns = [
//             { key: 'date', width: 14 }, { key: 'className', width: 20 },
//             { key: 'subjects', width: 28 }, { key: 'director', width: 18 },
//             { key: 'phone', width: 15 }, { key: 'address', width: 38 },
//             { key: 'studentCount', width: 12 }, { key: 'classCount', width: 12 },
//             { key: 'remark', width: 20 },
//         ];
//         ws.mergeCells('A1:I1');
//         const titleCell = ws.getCell('A1');
//         titleCell.value = `${workerName} (sales executive)`;
//         titleCell.font = { bold: true, size: 13 };
//         titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
//         titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
//         ws.getRow(1).height = 25;
//         const headerRow = ws.addRow(['Date', 'Class Name', 'Subjects Taught', 'Director',
//             'Phone', 'Address', 'Student Count', 'Class Count', 'Remark']);
//         headerRow.eachCell(cell => {
//             cell.font = { bold: true, size: 11 };
//             cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
//             cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
//             cell.alignment = { wrapText: true, vertical: 'middle' };
//         });
//         headerRow.height = 30;
//         if (shift.notes?.length > 0) {
//             shift.notes.forEach(note => {
//                 const row = ws.addRow([shift.date, note.className || '', note.contactPersonName || '',
//                 note.directorName || '', note.directorNumber || '', note.address || '',
//                 note.studentCount ?? 0, note.classCount ?? 0, '']);
//                 row.eachCell(cell => {
//                     cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
//                     cell.alignment = { wrapText: true, vertical: 'top' };
//                 });
//             });
//         } else {
//             const row = ws.addRow([shift.date, '', '', '', '', 'No notes recorded for this shift', '', '', '']);
//             row.eachCell(cell => {
//                 cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
//             });
//         }
//         const fileName = `Report_${shift.date.replace(/\//g, '-')}.xlsx`;
//         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
//         await workbook.xlsx.write(res);
//         res.end();
//     } catch (error) {
//         res.status(500).json({ message: "Internal Server Error" });
//     }
// });

// // ─────────────────────────────────────────────
// //              START SERVER
// // ─────────────────────────────────────────────

// // ✅ Use server.listen instead of app.listen (required for Socket.IO)
// const PORT = 5000;
// server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server on port ${PORT}`)); 


const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const ExcelJS = require('exceljs');

const User = require('./models/User');
const Shift = require('./models/Shift');
const Note = require('./models/Note');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

//  1. MongoDB Connection
// mongoose.connect('mongodb+srv://bharatsharma:India%406427@users.zhyvuoo.mongodb.net/tracking?retryWrites=true&w=majority')
//     .then(() => console.log("✅ Connected to MongoDB"))
//     .catch((err) => console.error("❌ MongoDB connection error:", err));

mongoose.connect('mongodb+srv://netrutv:Netrutv39@basic.mtdr6.mongodb.net/tracking?retryWrites=true&w=majority')
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));

const cleanId = (id) => {
    if (!id) return null;
    const cleaned = id.toString().replace(/['"]+/g, '').trim();
    if (!mongoose.Types.ObjectId.isValid(cleaned)) return null;
    return new mongoose.Types.ObjectId(cleaned);
};

// ─────────────────────────────────────────────
//         SOCKET.IO — REAL TIME TRACKING
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('🔌 Socket connected:', socket.id);

    // Worker joins their own shift room
    socket.on('join_shift', ({ shiftId }) => {
        socket.join(`shift_${shiftId}`);
        console.log(`👷 Worker joined shift room: shift_${shiftId}`);
    });

    // Admin watches a shift room
    socket.on('watch_shift', ({ shiftId }) => {
        socket.join(`shift_${shiftId}`);
        console.log(`👁️ Admin watching shift: ${shiftId}`);
    });

    // ✅ Worker sends live location (now includes accuracy + speed)
    socket.on('location_update', async ({ userId, latitude, longitude, shiftId, accuracy, speed }) => {
        try {
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const uid = cleanId(userId);

            const shift = await Shift.findOneAndUpdate(
                { userId: uid, logoutTime: 'Ongoing' },
                { $push: { path: { latitude: lat, longitude: lng, timestamp: new Date() } } },
                { new: true }
            );
            if (!shift) return;

            // ✅ Broadcast to admin with accuracy + speed so LiveTrack & DayDetails
            //    can show signal quality and filter bad GPS points client-side
            io.to(`shift_${shift._id.toString()}`).emit('location_updated', {
                latitude: lat,
                longitude: lng,
                accuracy: accuracy ?? null,   // ← metres (e.g. 8.5)
                speed: speed ?? null,         // ← m/s  (multiply × 3.6 for km/h)
                shiftId: shift._id.toString(),
                totalPoints: shift.path.length,
            });

            console.log(`📍 [${lat.toFixed(5)}, ${lng.toFixed(5)}] acc=${accuracy}m spd=${speed} → shift_${shift._id}`);
        } catch (err) {
            console.error('Socket location_update error:', err.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Socket disconnected:', socket.id);
    });
});

// ─────────────────────────────────────────────
//              AUTH ROUTES
// ─────────────────────────────────────────────

app.get('/api/auth/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const id = userId.replace(/['"]+/g, '').trim();
        if (!mongoose.Types.ObjectId.isValid(id))
            return res.status(400).json({ message: "Invalid ID format" });
        const user = await User.findById(id).select('-password');
        if (!user) return res.status(404).json({ message: "User not found" });
        const userObj = user.toObject();
        if (user.profileImage && user.profileImage.data)
            userObj.profileImage.data = user.profileImage.data.toString('base64');
        res.json(userObj);
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (!user) return res.status(400).json({ message: "Invalid credentials" });
        const activeShift = await Shift.findOne({ userId: user._id, logoutTime: 'Ongoing' });
        res.json({
            userId: user._id.toString(),
            name: user.name,
            role: user.role,
            isShiftActive: !!activeShift,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password, profileImage, role, adminKey } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email already in use" });
        let finalRole = 'worker';
        if (role === 'admin') {
            if (adminKey !== "admin")
                return res.status(403).json({ message: "Invalid Admin Key." });
            finalRole = 'admin';
        }
        const newUser = new User({ name, email, password, role: finalRole });
        if (profileImage) {
            newUser.profileImage = {
                data: Buffer.from(profileImage, 'base64'),
                contentType: 'image/jpeg'
            };
        }
        await newUser.save();
        res.status(201).json({ userId: newUser._id });
    } catch (e) {
        res.status(500).json({ message: "Signup failed: " + e.message });
    }
});

// ─────────────────────────────────────────────
//              SHIFT ROUTES
// ─────────────────────────────────────────────

app.post('/api/shift/start', async (req, res) => {
    try {
        const userId = cleanId(req.body.userId);
        const existing = await Shift.findOne({ userId, logoutTime: 'Ongoing' });
        if (existing) return res.status(200).json({ startTime: existing.startTime, shiftId: existing._id });
        const shift = await Shift.create({
            userId,
            startTime: new Date(),
            date: new Date().toLocaleDateString('en-IN'),
            logoutTime: 'Ongoing',
            path: [],
            notes: []
        });
        await User.findByIdAndUpdate(userId, { isShiftActive: true });
        res.status(201).json({ startTime: shift.startTime, shiftId: shift._id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/shift/end', async (req, res) => {
    try {
        const userId = cleanId(req.body.userId);
        const now = new Date();
        const logoutTimeStr = now.toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        const shift = await Shift.findOneAndUpdate(
            { userId, logoutTime: 'Ongoing' },
            { endTime: now, logoutTime: logoutTimeStr },
            { new: true }
        );
        await User.findByIdAndUpdate(userId, { isShiftActive: false });
        if (!shift) return res.status(200).json({ message: "Already ended" });
        res.json({
            message: "Shift ended",
            summary: { pointsTracked: shift.path.length, notesCaptured: shift.notes.length }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/shift/active/:userId', async (req, res) => {
    try {
        const userId = cleanId(req.params.userId);
        const shift = await Shift.findOne({ userId, logoutTime: 'Ongoing' }).lean();
        if (!shift) return res.status(404).json({ message: "No active shift" });
        res.json(shift);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/shift-details/:shiftId', async (req, res) => {
    try {
        const shift = await Shift.findById(req.params.shiftId).populate('notes').lean();
        if (!shift) return res.status(404).json({ message: "Shift not found" });
        res.status(200).json({ date: shift.date, path: shift.path || [], notes: shift.notes || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
//    TRACKING ROUTE (HTTP fallback)
// ─────────────────────────────────────────────

app.post('/api/track', async (req, res) => {
    try {
        const userId = cleanId(req.body.userId);
        if (!userId) return res.status(400).json({ message: "Invalid userId" });
        const lat = parseFloat(req.body.latitude);
        const lng = parseFloat(req.body.longitude);
        if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ message: "Invalid coordinates" });

        const shift = await Shift.findOneAndUpdate(
            { userId, logoutTime: 'Ongoing' },
            { $push: { path: { latitude: lat, longitude: lng, timestamp: new Date() } } },
            { new: true }
        );
        if (!shift) return res.status(404).json({ message: "No active shift" });

        // Also broadcast via socket when REST fallback is used
        io.to(`shift_${shift._id.toString()}`).emit('location_updated', {
            latitude: lat,
            longitude: lng,
            accuracy: req.body.accuracy ?? null,
            speed: null,
            shiftId: shift._id.toString(),
            totalPoints: shift.path.length,
        });

        res.status(200).json({ count: shift.path.length });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─────────────────────────────────────────────
//              NOTES ROUTE
// ─────────────────────────────────────────────

app.post('/api/notes', async (req, res) => {
    try {
        const {
            userId, className, directorName, directorNumber, address,
            contactPersonName, contactPersonNumber, studentCount, classCount, remark,
            latitude, longitude
        } = req.body;

        const newNote = new Note({
            userId, className, directorName, directorNumber, address,
            contactPersonName, contactPersonNumber, studentCount, classCount, remark,
            latitude, longitude
        });
        await newNote.save();

        const shift = await Shift.findOneAndUpdate(
            { userId, logoutTime: 'Ongoing' },
            { $push: { notes: newNote._id } },
            { new: true }
        );
        if (!shift) return res.status(404).json({ message: "No active shift found" });

        // ✅ Broadcast new note instantly to admin watching this shift room
        //    DayDetails listens for 'note_added' to show the pin without refresh
        io.to(`shift_${shift._id.toString()}`).emit('note_added', {
            _id: newNote._id.toString(),
            className: newNote.className,
            directorName: newNote.directorName,
            directorNumber: newNote.directorNumber,
            address: newNote.address,
            contactPersonName: newNote.contactPersonName,
            contactPersonNumber: newNote.contactPersonNumber,
            studentCount: newNote.studentCount,
            classCount: newNote.classCount,
            remark: newNote.remark,
            latitude: newNote.latitude,
            longitude: newNote.longitude,
            createdAt: newNote.createdAt,
        });

        console.log(`📝 Note saved + emitted to shift_${shift._id}: ${className}`);

        res.status(201).json({ message: "Note recorded and linked to shift" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─────────────────────────────────────────────
//         HISTORY ROUTE
// ─────────────────────────────────────────────

app.get('/api/history/:userId', async (req, res) => {
    try {
        const userId = cleanId(req.params.userId);
        if (!userId) return res.status(400).json({ message: "Invalid User ID format" });

        const archivedShifts = await Shift.find({ userId })
            .sort({ createdAt: -1 })
            .populate('notes');

        const historyLog = archivedShifts.map(s => ({
            _id: s._id,
            date: s.date,
            loginTime: s.startTime
                ? new Date(s.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                : "N/A",
            logoutTime: s.logoutTime === 'Ongoing'
                ? 'Ongoing'
                : (s.endTime
                    ? new Date(s.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                    : "N/A"),
            path: s.path || [],
            notes: s.notes || [],
        }));

        res.status(200).json(historyLog);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
//              ADMIN ROUTES
// ─────────────────────────────────────────────

app.get('/api/admin/ongoing-shifts', async (req, res) => {
    try {
        const shifts = await Shift.find({ logoutTime: 'Ongoing' })
            .populate('userId', 'name profileImage')
            .sort({ startTime: -1 });
        res.json(shifts);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/shift/:id', async (req, res) => {
    try {
        const shift = await Shift.findById(req.params.id);
        res.json(shift);
    } catch (err) {
        res.status(500).json({ message: "Error fetching path" });
    }
});

app.get('/api/admin/all-workers', async (req, res) => {
    try {
        const workers = await User.find({ role: 'worker' })
            .select('name email profileImage role').sort({ name: 1 });
        const formattedWorkers = workers.map(worker => {
            const workerObj = worker.toObject();
            if (worker.profileImage && worker.profileImage.data) {
                workerObj.profileImage = `data:${worker.profileImage.contentType};base64,`
                    + worker.profileImage.data.toString('base64');
            }
            return workerObj;
        });
        res.status(200).json(formattedWorkers);
    } catch (err) {
        res.status(500).json({ message: "Error formatting worker data" });
    }
});

// ─────────────────────────────────────────────
//    SHARED EXCEL WORKSHEET BUILDER
// ─────────────────────────────────────────────

const buildWorksheet = (ws, titleValue, shifts) => {
    ws.columns = [
        { key: 'date', width: 14 },
        { key: 'className', width: 22 },
        { key: 'subjects', width: 28 },
        { key: 'director', width: 18 },
        { key: 'phone', width: 15 },
        { key: 'address', width: 38 },
        { key: 'studentCount', width: 14 },
        { key: 'classCount', width: 12 },
        { key: 'remark', width: 24 },
    ];

    ws.mergeCells('A1:I1');
    const titleCell = ws.getCell('A1');
    titleCell.value = titleValue;
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    ws.getRow(1).height = 28;

    const headerRow = ws.addRow([
        'Date', 'Class Name', 'Subjects Taught', 'Director',
        'Phone', 'Address', 'Student Count', 'Class Count', 'Remark'
    ]);
    headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' }
        };
        cell.alignment = { wrapText: true, vertical: 'middle' };
    });
    headerRow.height = 30;

    shifts.forEach(shift => {
        if (shift.notes && shift.notes.length > 0) {
            shift.notes.forEach(note => {
                const row = ws.addRow([
                    shift.date,
                    note.className || '',
                    note.contactPersonName || '',
                    note.directorName || '',
                    note.directorNumber || '',
                    note.address || '',
                    note.studentCount ?? 0,
                    note.classCount ?? 0,
                    note.remark || '',
                ]);
                row.eachCell(cell => {
                    cell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' },
                        bottom: { style: 'thin' }, right: { style: 'thin' }
                    };
                    cell.alignment = { wrapText: true, vertical: 'top' };
                });
            });
        } else {
            const row = ws.addRow([shift.date, '', '', '', '', 'No notes recorded', '', '', '']);
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' }, left: { style: 'thin' },
                    bottom: { style: 'thin' }, right: { style: 'thin' }
                };
                cell.alignment = { wrapText: true, vertical: 'top' };
            });
        }
    });
};

// ─────────────────────────────────────────────
//         EXCEL EXPORT ROUTES
// ─────────────────────────────────────────────

app.get('/api/export-monthly-notes', async (req, res) => {
    try {
        const { month, year } = req.query;
        const datePattern = new RegExp(`\\/${month}\\/${year}$`);
        const shifts = await Shift.find({ date: { $regex: datePattern } })
            .populate('notes').populate('userId', 'name');
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Monthly Report');
        buildWorksheet(ws, `Monthly Report - ${month}/${year}`, shifts);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Report_${month}_${year}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download-shift-report/:shiftId', async (req, res) => {
    try {
        const shift = await Shift.findById(req.params.shiftId)
            .populate('notes').populate('userId', 'name');
        if (!shift) return res.status(404).json({ message: "Shift not found" });
        const workerName = shift.userId?.name || 'Worker';
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Report');
        buildWorksheet(ws, `${workerName} (sales executive)`, [shift]);
        const fileName = `Report_${shift.date.replace(/\//g, '-')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

app.get('/api/export-range/:userId', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const userId = cleanId(req.params.userId);
        if (!userId) return res.status(400).json({ message: "Invalid user ID" });
        const user = await User.findById(userId).select('name');
        const workerName = user?.name || 'Worker';
        const shifts = await Shift.find({ userId }).populate('notes').sort({ createdAt: -1 });

        const parseDate = (str) => {
            const [d, m, y] = str.split('/');
            return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        };
        const start = parseDate(startDate);
        const end = parseDate(endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        const parseShiftDate = (dateStr) => {
            const parts = dateStr.replace(/-/g, '/').split('/');
            if (parts.length === 3) {
                const [d, m, y] = parts;
                return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            }
            return new Date(dateStr);
        };

        const filtered = shifts.filter(s => {
            const d = parseShiftDate(s.date);
            return d >= start && d <= end;
        });

        if (filtered.length === 0)
            return res.status(404).json({ message: "No shifts found in date range" });

        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Shift Report');
        buildWorksheet(ws, `${workerName} (sales executive)`, filtered);
        const safeStart = startDate.replace(/\//g, '-');
        const safeEnd = endDate.replace(/\//g, '-');
        const fileName = `${workerName.replace(/\s+/g, '_')}_${safeStart}_to_${safeEnd}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Range export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
//              START SERVER
// ─────────────────────────────────────────────
const PORT = 5000;
server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server on port ${PORT}`));