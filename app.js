const express = require('express');
const mysql = require('mysql2'); 
const app = express();
const bcrypt = require('bcryptjs');
const saltRounds = 10;
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const moment = require('moment-timezone');

require('dotenv').config();

const secretKey = process.env.JWT_SECRET;

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10, 
  queueLimit: 0
});

app.use(express.json());


// Register endpoint
app.post('/register', (req, res) => {
  const { username, password, id_cabang } = req.body;

  pool.query('SELECT username FROM users WHERE username = ?', [username], (err, results) => {
    if (err) {
      res.status(500).send('Error checking for existing user!');
      return;
    }

    if (results.length > 0) {
      res.status(400).send('Username already exists!');
      return;
    }

    bcrypt.hash(password, saltRounds, (err, hash) => {
      if (err) {
        res.status(500).send('Error hashing password!');
        return;
      }

      const sql = 'INSERT INTO users (username, password, id_cabang) VALUES (?, ?, ?)';
      pool.query(sql, [username, hash, id_cabang], (err, results) => {
        if (err) {
          res.status(500).send('Error creating user!');
          return;
        }
        res.send('User registered successfully!');
      });
    });
  });
});

//Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const sql = `
    SELECT users.*, cabang.nama_cabang 
    FROM users 
    JOIN cabang ON users.id_cabang = cabang.id_cabang 
    WHERE users.username = ?`;

  pool.getConnection((err, connection) => {
    if (err) {
      console.error('Error getting connection from pool:', err);
      res.status(500).send('Database connection error');
      return;
    }

    connection.query(sql, [username], (err, results) => {
      connection.release(); 

      if (err) {
        console.error('Error executing SQL query:', err);
        res.status(500).send('Error finding user!');
        return;
      }

      if (results.length === 0) {
        res.status(400).send('Invalid username or password!');
        return;
      }

      const user = results[0];
      bcrypt.compare(password, user.password, (err, isMatch) => {  
        if (err) {
          console.error('Error comparing passwords:', err);
          res.status(500).send('Error comparing passwords!');
          return;
        }

        if (!isMatch) {
          res.status(400).send('Invalid username or password!');
          return;
        }

        // Generate JWT token
        const token = jwt.sign(
          { id: user.id, username: user.username, id_cabang: user.id_cabang, nama_cabang: user.nama_cabang },
          secretKey,
          { expiresIn: '1h' }
        );

        res.json({ message: 'Login successful!', token, id_cabang: user.id_cabang, nama_cabang: user.nama_cabang });
      });
    });
  });
});

// Middleware to authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, secretKey, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

app.get('/protected', authenticateToken, (req, res) => {
  res.send('This is a protected route');
});

// Create Transaction (Completed or Draft)
app.post('/transaksi', (req, res) => {
  const {
    nama_pelanggan,
    nomor_telepon,
    total_harga,
    metode_pembayaran,
    id_member,
    id_cabang,
    items,
    isDraft
  } = req.body;

  const status = isDraft ? 1 : 0; // Draft if isDraft is true, otherwise Completed

  // Log the incoming request data for debugging
  console.log('Incoming transaction request:', req.body);

  // Check required fields
  if (!total_harga || !metode_pembayaran || !id_cabang || !items) {
    return res.status(400).send('Missing required fields!');
  }

  // Check if id_member exists and get member details
  if (id_member) {
    pool.query('SELECT nama_member, nomor_telepon FROM member WHERE id_member = ?', [id_member], (err, results) => {
      if (err) {
        console.error('Error checking member:', err);
        res.status(500).send('Error checking member!');
        return;
      }

      if (results.length === 0) {
        res.status(400).send('Member not found!');
        return;
      }

      const member = results[0];
      createTransaction(member.nama_member, member.nomor_telepon, id_member);
    });
  } else {
    if (!nama_pelanggan || !nomor_telepon) {
      return res.status(400).send('Missing customer name or phone number!');
    }
    createTransaction(nama_pelanggan, nomor_telepon, null); // Pass null for id_member if not provided
  }

  function createTransaction(nama, nomor, memberId) {
    const currentDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'); // Adjust to WIB (UTC+7)
    const sqlTransaksi = 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, id_cabang, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    const params = [nama, nomor, total_harga, metode_pembayaran, memberId, id_cabang, status, currentDate];

    pool.query(sqlTransaksi, params, (err, results) => {
      if (err) {
        console.error('Error creating transaction:', err);
        res.status(500).send('Error creating transaction!');
        return;
      }

      const id_transaksi = results.insertId;

      const sqlItemTransaksi = 'INSERT INTO item_transaksi (id_transaksi, id_layanan, catatan, harga, id_karyawan, created_at) VALUES ?';
      const values = items.map(item => [
        id_transaksi,
        item.id_layanan,
        item.catatan,
        item.harga,
        item.id_karyawan,
        currentDate
      ]);

      pool.query(sqlItemTransaksi, [values], (err, results) => {
        if (err) {
          console.error('Error creating transaction items:', err);
          res.status(500).send('Error creating transaction items!');
          return;
        }

        if (status === 0) {
          // Calculate and update the commission for each karyawan only if the transaction is completed
          updateKomisi(items, currentDate, res);
        } else {
          res.send('Draft transaction created!');
        }
      });
    });
  }

  function updateKomisi(items, transactionDate, res) {
    const transactionMoment = moment(transactionDate, 'YYYY-MM-DD HH:mm:ss')
    const hour = transactionMoment.hour();

    let updatePromises = items.map(item => {
      return new Promise((resolve, reject) => {
        const getKomisiSql = 'SELECT persen_komisi, persen_komisi_luarjam FROM layanan WHERE id_layanan = ?';
        pool.query(getKomisiSql, [item.id_layanan], (err, results) => {
          if (err) {
            console.error('Error retrieving commission percentage:', err);
            reject('Error retrieving commission percentage!');
            return;
          }
  
          if (results.length > 0) {
            const { persen_komisi, persen_komisi_luarjam } = results[0];
            
            // Check if the transaction time is outside working hours (before 9 AM or after 6 PM)
            const isOutsideWorkingHours = hour < 9 || hour >= 18;
            const komisiPercentage = isOutsideWorkingHours ? persen_komisi_luarjam : persen_komisi;
            const komisi = item.harga * (komisiPercentage / 100);
  
            const updateKomisiSql = `
              UPDATE karyawan 
              SET komisi_harian = komisi_harian + ?, 
                  komisi = komisi + ? 
              WHERE id_karyawan = ?`;
  
            pool.query(updateKomisiSql, [komisi, komisi, item.id_karyawan], (err, results) => {
              if (err) {
                console.error('Error updating commissions:', err);
                reject('Error updating commissions!');
                return;
              }
  
              resolve();
            });
          } else {
            reject('Service not found!');
          }
        });
      });
    });

    console.log(`Transaction time in Jakarta timezone: ${transactionMoment.format('YYYY-MM-DD HH:mm:ss')} (Hour: ${hour})`);

    Promise.all(updatePromises)
      .then(() => {
        res.send('Transaction and items created successfully, and commissions updated!');
      })
      .catch(error => {
        console.error('Promise error:', error);
        res.status(500).send(error);
      });
  }
});

// Get Transaksi by ID
app.get('/transaksi/:id', (req, res) => {
  const id = req.params.id;
  const sqlTransaksi = 'SELECT * FROM transaksi WHERE id_transaksi = ?';
  const sqlItems = `
    SELECT it.*, k.nama_karyawan, l.nama_layanan 
    FROM item_transaksi it
    JOIN karyawan k ON it.id_karyawan = k.id_karyawan
    JOIN layanan l ON it.id_layanan = l.id_layanan
    WHERE it.id_transaksi = ?`;

   pool.query(sqlTransaksi, [id], (err, transaksiResults) => {
    if (err) {
      res.status(500).send('Error retrieving transaction!');
      throw err;
    }

    if (transaksiResults.length === 0) {
      res.status(404).send('Transaction not found!');
      return;
    }

    connection.query(sqlItems, [id], (err, itemResults) => {
      if (err) {
        res.status(500).send('Error retrieving transaction items!');
        throw err;
      }

      res.send({
        transaksi: transaksiResults[0],
        items: itemResults
      });
    });
  });
});

// Get Transaksi by Date and Cabang
app.get('/transaksi/date/:date/cabang/:id_cabang', (req, res) => {
  const date = req.params.date;
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM transaksi WHERE DATE(created_at) = ? AND id_cabang = ? AND status = 0 ORDER BY created_at DESC';

   pool.query(sql, [date, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving transactions!');
      throw err;
    }

    res.send(results);
  });
});

// Get Monthly Transaksi by Cabang
app.get('/transaksi/month/:month/year/:year/cabang/:id_cabang', (req, res) => {
  const month = req.params.month;
  const year = req.params.year;
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM transaksi WHERE MONTH(created_at) = ? AND YEAR(created_at) = ? AND id_cabang = ? AND status = 0 ORDER BY created_at DESC';
  
  pool.query(sql, [month, year, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving transactions!');
      throw err;
    }

    res.send(results);
  });
});

// Get Draft Transaksi by Cabang
app.get('/transaksi/draft/cabang/:id_cabang', (req, res) => {
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM transaksi WHERE id_cabang = ? AND status = 1 ORDER BY created_at DESC';

  pool.query(sql, [id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving draft transactions!');
      throw err;
    }

    res.send(results);
  });
});

// Delete transaksi by id
app.delete('/transaksi/:id_transaksi', (req, res) => {
  const idTransaksi = req.params.id_transaksi;

  // Start a transaction
  pool.getConnection((err, connection) => {
    if (err) {
      res.status(500).send('Error getting connection!');
      throw err;
    }

    connection.beginTransaction((err) => {
      if (err) {
        res.status(500).send('Error starting transaction!');
        connection.release();
        throw err;
      }

      // SQL to delete items associated with the transaction
      const deleteItemsSql = 'DELETE FROM item_transaksi WHERE id_transaksi = ?';
      connection.query(deleteItemsSql, [idTransaksi], (err, result) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).send('Error deleting transaction items!');
            connection.release();
            throw err;
          });
        }

        // SQL to delete the transaction
        const deleteTransaksiSql = 'DELETE FROM transaksi WHERE id_transaksi = ?';
        connection.query(deleteTransaksiSql, [idTransaksi], (err, result) => {
          if (err) {
            return connection.rollback(() => {
              res.status(500).send('Error deleting transaction!');
              connection.release();
              throw err;
            });
          }

          // Commit the transaction
          connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).send('Error committing transaction!');
                connection.release();
                throw err;
              });
            }

            connection.release();

            if (result.affectedRows === 0) {
              res.status(404).send('Transaction not found!');
            } else {
              res.send('Transaction and its items deleted successfully!');
            }
          });
        });
      });
    });
  });
});

// CRUD Karyawan
app.post('/karyawan', (req, res) => {
  const { nama_karyawan, alamat, nomor_telepon, id_cabang } = req.body;
  const sql = 'INSERT INTO karyawan (nama_karyawan, alamat, nomor_telepon, id_cabang) VALUES (?, ?, ?, ?)';
  pool.query(sql, [nama_karyawan, alamat, nomor_telepon, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error creating karyawan!');
      throw err;
    }
    res.send('Karyawan created!');
  });
});

app.get('/karyawan/id/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'SELECT * FROM karyawan WHERE id_karyawan = ?';
  pool.query(sql, [id], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving karyawan by id!');
      throw err;
    }
    res.send(results);
  });
});

app.get('/karyawan/:id_cabang', (req, res) => {
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM karyawan WHERE id_cabang = ?';
  pool.query(sql, [id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving karyawan!');
      throw err;
    }
    res.send(results);
  });
});

app.put('/karyawan/:id', (req, res) => {
  const id = req.params.id;
  const { nama_karyawan, alamat, nomor_telepon, id_cabang } = req.body;
  const sql = 'UPDATE karyawan SET nama_karyawan = ?, alamat = ?, nomor_telepon = ?, id_cabang = ? WHERE id_karyawan = ?';
  pool.query(sql, [nama_karyawan, alamat, nomor_telepon, id_cabang, id], (err, results) => {
    if (err) {
      res.status(500).send('Error updating karyawan!');
      throw err;
    }
    res.send('Karyawan updated!');
  });
});

app.delete('/karyawan/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'DELETE FROM karyawan WHERE id_karyawan = ?';
  pool.query(sql, [id], (err, results) => {
    if (err) {
      res.status(500).send('Error deleting karyawan!');
      throw err;
    }
    res.send('Karyawan deleted!');
  });
});

// Schedule task to clear daily commissions at midnight WIB
cron.schedule('0 0 * * *', () => {
  const now = moment().tz('Asia/Jakarta');
  const hourInUTC = now.hour();
  const minuteInUTC = now.minute();
  const cronExpression = `${minuteInUTC} ${hourInUTC} * * *`;

  const sql = `
    UPDATE karyawan
    SET komisi_harian = 0
  `;

  pool.query(sql, (err, result) => {
    if (err) {
      console.error('Error clearing daily commissions:', err);
      return;
    }

    console.log('Daily commissions cleared successfully!');
  });
}, {
  scheduled: true,
  timezone: "Asia/Jakarta"
});

// Schedule task to clear monthly commissions on the first day of every month at midnight WIB
cron.schedule('0 0 1 * *', () => {
  const now = moment().tz('Asia/Jakarta');
  const hourInUTC = now.hour();
  const minuteInUTC = now.minute();
  const cronExpression = `${minuteInUTC} ${hourInUTC} 1 * *`;

  const sql = `
    UPDATE karyawan
    SET komisi = 0
  `;

  pool.query(sql, (err, result) => {
    if (err) {
      console.error('Error clearing monthly commissions:', err);
      return;
    }

    console.log('Monthly commissions cleared successfully!');
  });
}, {
  scheduled: true,
  timezone: "Asia/Jakarta"
});

// CRUD Layanan
// Add Layanan
app.post('/layanan', (req, res) => {
  const { nama_layanan, persen_komisi, persen_komisi_luarjam, kategori } = req.body;
  const sql = 'INSERT INTO layanan (nama_layanan, persen_komisi, persen_komisi_luarjam, kategori) VALUES (?, ?, ?, ?)';
  pool.query(sql, [nama_layanan, persen_komisi, persen_komisi_luarjam, kategori], (err, results) => {
    if (err) {
      console.error('Error creating layanan:', err);
      res.status(500).json({ error: 'Error creating layanan!' });
      return;
    }
    res.status(201).json({ message: 'Layanan created!', id_layanan: results.insertId });
  });
});

// Get all Layanan
app.get('/layanan', (req, res) => {
  const sql = 'SELECT * FROM layanan';
  pool.query(sql, (err, results) => {
    if (err) {
      console.error('Error retrieving layanan:', err);
      res.status(500).json({ error: 'Error retrieving layanan!' });
      return;
    }
    res.status(200).json(results);
  });
});

// Get Layanan by ID
app.get('/layanan/:id', (req, res) => {
  const id_layanan = req.params.id;
  const sql = 'SELECT * FROM layanan WHERE id_layanan = ?';
  pool.query(sql, [id_layanan], (err, results) => {
    if (err) {
      console.error('Error retrieving layanan by ID:', err);
      res.status(500).json({ error: 'Error retrieving layanan!' });
      return;
    }
    if (results.length === 0) {
      res.status(404).json({ error: 'Layanan not found!' });
      return;
    }
    res.status(200).json(results[0]);
  });
});

// Edit Layanan
app.put('/layanan/:id', (req, res) => {
  const id_layanan = req.params.id;
  const { nama_layanan, persen_komisi, persen_komisi_luarjam, kategori } = req.body;
  const sql = 'UPDATE layanan SET nama_layanan = ?, persen_komisi = ?, persen_komisi_luarjam = ?, kategori = ? WHERE id_layanan = ?';
  pool.query(sql, [nama_layanan, persen_komisi, persen_komisi_luarjam, kategori, id_layanan], (err, results) => {
    if (err) {
      console.error('Error updating layanan:', err);
      res.status(500).json({ error: 'Error updating layanan!' });
      return;
    }
    res.status(200).json({ message: 'Layanan updated!', id_layanan: id_layanan });
  });
});

// Delete Layanan
app.delete('/layanan/:id', (req, res) => {
  const id_layanan = req.params.id;
  const sql = 'DELETE FROM layanan WHERE id_layanan = ?';
  pool.query(sql, [id_layanan], (err, results) => {
    if (err) {
      console.error('Error deleting layanan:', err);
      res.status(500).json({ error: 'Error deleting layanan!' });
      return;
    }
    res.status(200).json({ message: 'Layanan deleted!', id_layanan: id_layanan });
  });
});

// Create a new member
app.post('/member', (req, res) => {
  const { nomor_pelanggan, nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang } = req.body;
  const sql = 'INSERT INTO member (nomor_pelanggan, nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang) VALUES (?, ?, ?, ?, ?, ?, ?)';
  pool.query(sql, [nomor_pelanggan, nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang], (err, results) => {
      if (err) {
          res.status(500).send('Error creating member!');
          throw err;
      }
      res.send('Member created!');
  });
});

// Get all members
app.get('/members', (req, res) => {
  const sql = 'SELECT * FROM member';
  pool.query(sql, (err, results) => {
      if (err) {
          res.status(500).send('Error fetching members!');
          throw err;
      }
      res.json(results);
  });
});

// Get a member by ID
app.get('/member/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'SELECT * FROM member WHERE id_member = ?';
  pool.query(sql, [id], (err, results) => {
      if (err) {
          res.status(500).send('Error fetching member!');
          throw err;
      }
      res.json(results[0]);
  });
});

// Update a member
app.put('/member/:id', (req, res) => {
  const id = req.params.id;
  const { nomor_pelanggan, nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang } = req.body;
  const sql = 'UPDATE member SET nomor_pelanggan = ?, nama_member = ?, nomor_telepon = ?, alamat = ?, tanggal_lahir = ?, tanggal_daftar = ?, id_cabang = ? WHERE id_member = ?';
  pool.query(sql, [nomor_pelanggan, nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang, id], (err, results) => {
      if (err) {
          res.status(500).send('Error updating member!');
          throw err;
      }
      res.send('Member updated!');
  });
});

// Delete a member
app.delete('/member/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'DELETE FROM member WHERE id_member = ?';
  pool.query(sql, [id], (err, results) => {
      if (err) {
          res.status(500).send('Error deleting member!');
          throw err;
      }
      res.send('Member deleted!');
  });
});

// Get members by id_cabang
app.get('/member/cabang/:id_cabang', (req, res) => {
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM member WHERE id_cabang = ?';
  pool.query(sql, [id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error fetching members by cabang!');
      throw err;
    }
    res.json(results);
  });
});

// Count Money by Date and Branch
app.get('/money/date/:date/cabang/:id_cabang', (req, res) => {
  const date = req.params.date;
  const id_cabang = req.params.id_cabang;
  const sql = `
    SELECT 
      SUM(total_harga) AS total_money,
      SUM(CASE WHEN metode_pembayaran = 'cash' THEN total_harga ELSE 0 END) AS total_cash,
      SUM(CASE WHEN metode_pembayaran = 'transfer' THEN total_harga ELSE 0 END) AS total_transfer
    FROM transaksi 
    WHERE DATE(created_at) = ? AND id_cabang = ? AND status = 0
  `;

  pool.query(sql, [date, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving total money!');
      throw err;
    }

    const result = {
      total_money: results[0].total_money,
      total_cash: results[0].total_cash,
      total_transfer: results[0].total_transfer
    };

    res.send(result);
  });
});

// Get Total Money by Month 
app.get('/total_money/month/:month/year/:year/cabang/:id_cabang', (req, res) => {
  const month = req.params.month;
  const year = req.params.year;
  const id_cabang = req.params.id_cabang;
  const sql = `
    SELECT 
      SUM(total_harga) as total_money,
      SUM(CASE WHEN metode_pembayaran = 'cash' THEN total_harga ELSE 0 END) as total_cash,
      SUM(CASE WHEN metode_pembayaran = 'transfer' THEN total_harga ELSE 0 END) as total_transfer
    FROM transaksi 
    WHERE MONTH(created_at) = ? AND YEAR(created_at) = ? AND id_cabang = ? AND status = 0
  `;

  pool.query(sql, [month, year, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving total money!');
      throw err;
    }

    res.send(results[0]);
  });
});

// Create a new cabang
app.post('/cabang', (req, res) => {
  const { nama_cabang, kode_cabang } = req.body;
  const sql = 'INSERT INTO cabang (nama_cabang, kode_cabang) VALUES (?, ?)';
  pool.query(sql, [nama_cabang, kode_cabang], (err, result) => {
    if (err) {
      console.error('Error creating cabang:', err);
      res.status(500).send('Error creating cabang!');
      return;
    }
    res.send({ message: 'Cabang created successfully!', id: result.insertId });
  });
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});