import Papa from 'papaparse';
import { User, AttendanceRecord, AttendanceType, SppdData, UserRole } from '../types';

const USERS_KEY = 'sdn_jambu_users';
const ATTENDANCE_KEY = 'sdn_jambu_attendance';

// GANTI LINK DI BAWAH INI DENGAN LINK PUBLIKASI CSV DARI GOOGLE SHEETS ANDA
const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhhXDs0nazcpQ25Ne_IbHsNI1vO7bBd6_CJv4-LLW1BEmdoZ5B5UA0G8zPQmFAlth1lAhfKdmRswNY/pub?gid=0&single=true&output=csv';

interface MockUser extends User {
  password?: string;
}

export const fetchUsersFromSheets = async (): Promise<MockUser[]> => {
  try {
    // Tambahkan parameter penangkal cache (cache-buster) agar browser selalu mengambil data terbaru
    const noCacheUrl = GOOGLE_SHEETS_CSV_URL + (GOOGLE_SHEETS_CSV_URL.includes('?') ? '&' : '?') + '_t=' + new Date().getTime();
    const response = await fetch(noCacheUrl, { cache: 'no-store' });
    
    if (!response.ok) {
        throw new Error(`Gagal mengambil CSV: ${response.status} ${response.statusText}`);
    }
    
    const csvData = await response.text();

    return new Promise((resolve, reject) => {
      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          const users: MockUser[] = results.data
            .filter((row: any) => {
                // Gunakan fleksibilitas untuk id dan username
                const idKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'id');
                const userKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'username');
                return row[idKey || 'id'] && row[userKey || 'username'];
            })
            .map((row: any) => {
              // Fungsi pintar untuk mencari key tanpa terpengaruh huruf besar/kecil atau spasi tersembunyi
              const getVal = (keyName: string) => {
                  const exactKey = Object.keys(row).find(k => k.trim().toLowerCase() === keyName.toLowerCase());
                  return exactKey ? String(row[exactKey] || '').trim() : '';
              };

              return {
                id: getVal('id'),
                name: getVal('name'),
                role: (['principal', 'kepala sekolah'].includes(getVal('role').toLowerCase()) ? 'principal' : 'teacher') as UserRole,
                nip: getVal('nip'),
                username: getVal('username'),
                password: getVal('password'),
                gender: (getVal('gender').toLowerCase() === 'p' || getVal('gender').toLowerCase() === 'female' ? 'female' : 'male') as 'male' | 'female',
                employmentStatus: getVal('employmentStatus'),
                position: getVal('position'),
                workUnit: getVal('workUnit'),
                avatar: getVal('avatar')
              };
            });
          
          // Simpan data terbaru ke localStorage
          localStorage.setItem(USERS_KEY, JSON.stringify(users));
          resolve(users);
        },
        error: (error: any) => {
          console.error("Gagal melakukan parsing CSV:", error);
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error("Gagal mengambil data dari Google Sheets:", error);
    throw error;
  }
};

export const initializeData = async () => {
    // Kita panggil fetchUsersFromSheets untuk memastikan data diperbarui, 
    // jika gagal kita akan coba gunakan data lama yang ada di localStorage
    try {
        await fetchUsersFromSheets();
    } catch {
        console.log("Menggunakan data user offline.");
    }
};

export const loginUser = async (username: string, password: string, requiredRole?: UserRole): Promise<User | null> => {
  // Selalu coba ambil data terbaru dari sheet saat mencoba login
  let users: MockUser[] = [];
  try {
      users = await fetchUsersFromSheets();
  } catch {
      // Fallback ke localStorage jika gagal mengambil (misal offline)
      users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
  }
  
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
  
  if (user) {
    // 1. Role Validation
    if (requiredRole) {
        // LOGIC UPDATE: 
        // If login requires 'teacher', we allow BOTH 'teacher' and 'principal'.
        // This allows the Principal to use the Teacher login form to take attendance.
        if (requiredRole === 'teacher') {
            if (user.role !== 'teacher' && user.role !== 'principal') {
                return null;
            }
        } else {
            // Strict check for 'principal' login tab (Teachers cannot enter here)
            if (user.role !== requiredRole) {
                return null;
            }
        }
    }

    // REMOVED: Device Lock Validation (Satu HP Satu User) - As per request

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
  return null;
};

export const getTodayRecord = (userId: string): AttendanceRecord | undefined => {
  const records: AttendanceRecord[] = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  const today = new Date().toISOString().split('T')[0];
  return records.find(r => r.userId === userId && r.date === today);
};

export const getUserHistory = (userId: string): AttendanceRecord[] => {
  const records: AttendanceRecord[] = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  // Filter by user ID and Sort by Date Descending (Newest first)
  return records
    .filter(r => r.userId === userId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getAllTodayRecords = (): AttendanceRecord[] => {
  const records: AttendanceRecord[] = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  const today = new Date().toISOString().split('T')[0];
  return records.filter(r => r.date === today);
};

export const getAllRecords = (): AttendanceRecord[] => {
  const records: AttendanceRecord[] = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  // Return all records sorted by date descending
  return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const saveAttendance = (record: AttendanceRecord): void => {
  const records: AttendanceRecord[] = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  const index = records.findIndex(r => r.id === record.id);
  
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  
  localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records));
};

export const sendToGAS = async (payload: any) => {
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbz673ECE4hjuf_xiCvuzjMQkXWWZGv9RR15Ed4UQ4SYtsdnT1MiGVSMpgZXQuLhgdO0/exec';
  try {
    // Menambahkan mode: 'no-cors' agar browser tidak memblokir pengiriman background.
    // Fetch ini akan menjadi "Opaque" bagi browser, tapi script Google tetap menerima body-nya.
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    console.log("Permintaan dikirim ke Background GAS (No-CORS).");
  } catch (err) {
    console.error("Gagal mengirim data ke Google Apps Script:", err);
  }
};

export const markCheckIn = async (user: User, location: string, photo: string, distanceValue?: string): Promise<AttendanceRecord> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  const todayDate = new Date();
  const today = todayDate.toISOString().split('T')[0];
  const time = todayDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  
  // Calculate Late Logic (07:30)
  const limit = new Date();
  limit.setHours(7, 30, 0, 0);
  
  let notes = "";
  if (todayDate > limit) {
      const diffMs = todayDate.getTime() - limit.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      notes = `TELAT ${diffMins} Menit`;
  }

  const newRecord: AttendanceRecord = {
    id: `${user.id}-${today}`,
    userId: user.id,
    userName: user.name,
    date: today,
    checkInTime: time,
    type: 'present',
    location,
    photo,
    notes: notes,
    avatar: user.avatar,
  };
  
  saveAttendance(newRecord);

  // Send to Google Sheets Background Process
  sendToGAS({
    action: 'CHECK_IN',
    date: today,
    time: time,
    nip: user.nip || '-',
    userName: user.name,
    location: location,
    photo: photo,
    distance: distanceValue || "-" // New distance field
  });

  return newRecord;
};

export const markCheckOut = async (user: User, location: string, photo: string, distanceValue?: string): Promise<AttendanceRecord | null> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  const record = getTodayRecord(user.id);
  
  if (!record || !record.checkInTime) return null;

  const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  
  const updatedRecord = { 
    ...record, 
    checkOutTime: time,
    location: location
  };
  
  saveAttendance(updatedRecord);

  // Send to Google Sheets Background Process
  sendToGAS({
    action: 'CHECK_OUT',
    date: record.date,
    time: time,
    nip: user.nip || '-',
    userName: user.name,
    location: location,
    photo: photo,
    distance: distanceValue || "-" // New distance field
  });

  return updatedRecord;
};

export const submitReport = async (
  user: User, 
  type: AttendanceType, 
  notes: string, 
  sppdData?: SppdData,
  attachment?: string,
  startDate?: string,
  endDate?: string
): Promise<AttendanceRecord> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const existing = getTodayRecord(user.id);
  
  let recordToSave: AttendanceRecord;

  if (existing) {
    recordToSave = {
      ...existing,
      type: sppdData ? 'sppd' : (type === 'present' ? existing.type : type), 
      notes: notes || existing.notes,
      sppdData: sppdData || existing.sppdData,
      attachment: attachment || existing.attachment,
      leaveStartDate: startDate || existing.leaveStartDate,
      leaveEndDate: endDate || existing.leaveEndDate
    };
  } else {
    recordToSave = {
      id: `${user.id}-${today}`,
      userId: user.id,
      userName: user.name,
      date: today,
      checkInTime: time, 
      type: sppdData ? 'sppd' : type,
      notes: notes,
      sppdData: sppdData,
      attachment: attachment,
      leaveStartDate: startDate,
      leaveEndDate: endDate
    };
  }

  saveAttendance(recordToSave);

  // Dispatch to GAS based on report type
  if (sppdData) {
      sendToGAS({
        action: 'INPUT_SPPD',
        userName: user.name,
        nip: user.nip || '-',
        activityType: sppdData.activityType,
        destination: sppdData.destination,
        startDate: sppdData.startDate,
        endDate: sppdData.endDate,
        resultReport: sppdData.resultReport,
        attachments: sppdData.attachments // Array of Base64 strings
      });
  } else if (type === 'sick' || type === 'leave') {
      sendToGAS({
        action: 'ABSEN_IZIN',
        userName: user.name,
        nip: user.nip || '-',
        type: type, // 'sick' or 'leave'
        startDate: startDate || today,
        endDate: endDate || today,
        notes: notes,
        attachment: attachment || ''
      });
  }

  return recordToSave;
};

// URL CSV Publik dari Sheet Absensi
const LIVE_ABSENSI_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRhhXDs0nazcpQ25Ne_IbHsNI1vO7bBd6_CJv4-LLW1BEmdoZ5B5UA0G8zPQmFAlth1lAhfKdmRswNY/pub?gid=344398975&single=true&output=csv";

export const fetchLivePeers = async (): Promise<AttendanceRecord[]> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const peersMap = new Map<string, AttendanceRecord>();

  // 1. Ambil data lokal dulu (supaya Sakit/Izin/SPPD dan status yang baru saja di-submit langsung terlihat)
  const localRecords = getAllTodayRecords();
  localRecords.forEach(r => peersMap.set(r.userName, { ...r }));

    // 2. Tarik data dari CSV
  try {
    // Kami menghapus cache-buster param (_t=) karena Google Docs sering memblokir
    // query param tidak dikenal dan menyebabkannya redirect yang memicu "Failed to fetch" (CORS Error)
    const res = await fetch(LIVE_ABSENSI_CSV, { cache: 'no-store' });
    const text = await res.text();
    const rows = text.split('\n');

    // Index CSV: 0:Timestamp, 1:Tanggal, 2:Jam, 3:Tipe(Masuk/Pulang), 4:NIP, 5:Nama, 6:Lokasi, 7:Jarak, 8:Link Foto
    for (let i = 1; i < rows.length; i++) {
       // Kita split secara aman. Terkadang ada koma di Lokasi, tapi karena Google Sheets menghasilkan CSV standar.
       // Regex ini memisahkan berdasarkan koma yang tidak ada di dalam tanda kutip.
       const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
       if (cols.length >= 6) {
          // Bersihkan tanda kutip jika ada
          const cleanCol = (col?: string) => col ? col.replace(/(^"|"$)/g, '').trim() : '';

          const tanggal = cleanCol(cols[1]); // kolom Tanggal
          // Periksa format tanggal yang konsisten. Google Sheets mungkin memakai YYYY-MM-DD
          if (tanggal === todayStr || !tanggal) {
              const jam = cleanCol(cols[2]);      // kolom Jam
              const tipe = cleanCol(cols[3]);     // kolom Tipe (Masuk / Pulang)
              const nip = cleanCol(cols[4]);      // NIP
              const nama = cleanCol(cols[5]);     // Nama

              if (tanggal === todayStr && nama) {
                  // Tentukan Tipe Asli dari CSV
                  let exactType = 'present';
                  if (tipe.toLowerCase() === 'sppd') exactType = 'sppd';
                  if (tipe.toLowerCase() === 'sakit') exactType = 'sick';
                  if (tipe.toLowerCase() === 'izin') exactType = 'leave';

                  if (!peersMap.has(nama)) {
                     // Jika tidak ada di lokal (misal absen dari HP lain)
                     peersMap.set(nama, {
                        id: nip || nama,
                        userId: nip || nama, // Kita gunakan NIP atau Nama sbg ID jika tdk tahu
                        userName: nama,
                        date: tanggal,
                        type: exactType as any
                     } as AttendanceRecord);
                  }

                  // Update data berdasarkan tipe dari baris
                  const record = peersMap.get(nama)!;
                  
                  // Jika di CSV tertulis Sakit/Izin/SPPD, JANGAN timpa dengan present
                  // dan update tipe jika saat ini present tapi ternyata ada catatan Sakit/Izin/SPPD
                  if (exactType !== 'present') {
                      record.type = exactType as any;
                  }

                  // Update jam kedatangan/kepulangan berdasarkan row
                  if (tipe === 'Masuk' || tipe === 'CHECK_IN') {
                      record.checkInTime = jam;
                  } else if (tipe === 'Pulang' || tipe === 'CHECK_OUT') {
                      record.checkOutTime = jam;
                  }
                  
                  // Pastikan type-nya tersetting minimal present jika belum
                  if (!record.type) record.type = 'present';
              }
          }
       }
    }
  } catch (err) {
    console.error("Gagal menarik live data dari CSV:", err);
  }

  // Convert map ke array, urutkan berdasarkan yang sudah hadir di atas
  const resultArray = Array.from(peersMap.values());
  resultArray.sort((a, b) => a.userName.localeCompare(b.userName));
  return resultArray;
};

export const downloadMonthlyReport = (startDate: string, endDate: string) => {
  const records: AttendanceRecord[] = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  
  // Filter records based on start and end date
  const filteredRecords = records.filter(r => {
    return r.date >= startDate && r.date <= endDate;
  });

  // Sort by Date (Oldest to Newest for report) then by Name
  filteredRecords.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.userName.localeCompare(b.userName);
  });
  
  const header = [
    'Tanggal', 
    'Nama Guru', 
    'NIP', 
    'Status', 
    'Masuk', 
    'Pulang', 
    'Lokasi', 
    'Catatan/Info SPPD', 
    'Mulai Izin', 
    'Selesai Izin'
  ];
  
  const getFullUser = (userId: string) => {
      const users: MockUser[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
      return users.find(u => u.id === userId);
  };

  const rows = filteredRecords.map(r => {
    const fullUser = getFullUser(r.userId);
    const nipReal = fullUser?.nip || '-';

    let noteContent = r.notes || '';
    if (r.sppdData) {
        noteContent = `SPPD: ${r.sppdData.activityType} di ${r.sppdData.destination}`;
    }

    // Translasi Status ke Bahasa Indonesia
    let statusIndonesia = 'Tidak Diketahui';
    if (r.type === 'present') statusIndonesia = 'Hadir';
    else if (r.type === 'sick') statusIndonesia = 'Sakit';
    else if (r.type === 'leave') statusIndonesia = 'Izin';
    else if (r.type === 'sppd') statusIndonesia = 'Dinas Luar (SPPD)';

    return [
        `"${r.date}"`,
        `"${r.userName}"`, // Protect titles like ", S.Pd"
        `"${nipReal}"`,    // Use actual NIP instead of userId
        `"${statusIndonesia}"`,
        `"${r.checkInTime || '-'}"`,
        `"${r.checkOutTime || '-'}"`,
        `"${r.location || '-'}"`,
        `"${noteContent}"`,
        `"${r.leaveStartDate || (r.sppdData ? r.sppdData.startDate : '-')}"`,
        `"${r.leaveEndDate || (r.sppdData ? r.sppdData.endDate : '-')}"`
    ];
  });

  const csvContent = [header, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  // Filename now includes range
  link.setAttribute("download", `laporan_absensi_sdn_jambu_${startDate}_sd_${endDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};