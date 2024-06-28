const express = require('express');
const mysql = require('mysql');
const app = express();
const bcrypt = require('bcrypt');
const saltRounds = 10;
const jwt = require('jsonwebtoken');
const secretKey = 'your_secret_key'; // Replace with your own secret key

app.use(express.json());

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'annisa_salon_manajemen'
});

connection.connect((err) => {
  if (err) throw err;
  console.log('Database connected!');
});

// Register endpoint
app.post('/register', (req, res) => {
  const { username, password, id_cabang } = req.body;

  connection.query('SELECT username FROM users WHERE username = ?', [username], (err, results) => {
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
      connection.query(sql, [username, hash, id_cabang], (err, results) => {
        if (err) {
          res.status(500).send('Error creating user!');
          return;
        }
        res.send('User registered successfully!');
      });
    });
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const sql = `
    SELECT users.*, cabang.nama_cabang 
    FROM users 
    JOIN cabang ON users.id_cabang = cabang.id_cabang 
    WHERE users.username = ?`;

  connection.query(sql, [username], (err, results) => {
    if (err) {
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

// Example protected route
app.get('/protected', authenticateToken, (req, res) => {
  res.send('This is a protected route');
});

// Create Transaction (Completed or Draft)
app.post('/transaksi', (req, res) => {
  const { nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, id_cabang, items } = req.body;
  const status = 0; // Completed

  // Log the incoming request data for debugging
  console.log('Incoming transaction request:', req.body);

  // Check if id_member exists and get member details
  if (id_member) {
    connection.query('SELECT id_member, nama_member, nomor_telepon FROM member WHERE id_member = ?', [id_member], (err, results) => {
      if (err) {
        console.error('Error checking member:', err);
        res.status(500).send('Error checking member!');
        return;
      }

      console.log('Member check results:', results);
      if (results.length === 0) {
        res.status(400).send('Member not found!');
        return;
      }

      const member = results[0];
      createTransaction(member.nama_member, member.nomor_telepon);
    });
  } else {
    createTransaction(nama_pelanggan, nomor_telepon);
  }

  function createTransaction(nama, nomor) {
    const sqlTransaksi = 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, id_cabang, status) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const params = [nama, nomor, total_harga, metode_pembayaran, id_member, id_cabang, status];

    connection.query(sqlTransaksi, params, (err, results) => {
      if (err) {
        console.error('Error creating transaction:', err);
        res.status(500).send('Error creating transaction!');
        throw err;
      }

      const id_transaksi = results.insertId;

      const sqlItemTransaksi = 'INSERT INTO item_transaksi (id_transaksi, id_layanan, catatan, harga, id_karyawan, created_at) VALUES ?';
      const currentDate = new Date();
      const values = items.map(item => [
        id_transaksi,
        item.id_layanan,
        item.catatan,
        item.harga,
        item.id_karyawan,
        currentDate
      ]);

      connection.query(sqlItemTransaksi, [values], (err, results) => {
        if (err) {
          console.error('Error creating transaction items:', err);
          res.status(500).send('Error creating transaction items!');
          throw err;
        }

        // Calculate and update the commission for each karyawan
        updateKomisi(items, currentDate, res);
      });
    });
  }

  function updateKomisi(items, transactionDate, res) {
    let updatePromises = items.map(item => {
      return new Promise((resolve, reject) => {
        const getKomisiSql = 'SELECT persen_komisi, persen_komisi_luarjam FROM layanan WHERE id_layanan = ?';
        connection.query(getKomisiSql, [item.id_layanan], (err, results) => {
          if (err) {
            console.error('Error retrieving commission percentage:', err);
            reject('Error retrieving commission percentage!');
            return;
          }

          if (results.length > 0) {
            const { persen_komisi, persen_komisi_luarjam } = results[0];
            const hour = transactionDate.getHours();
            const isOutsideWorkingHours = hour < 9 || hour >= 18;
            const komisiPercentage = isOutsideWorkingHours ? persen_komisi_luarjam : persen_komisi;
            const komisi = item.harga * (komisiPercentage / 100);

            const updateKomisiSql = `
              UPDATE karyawan 
              SET komisi_harian = komisi_harian + ?, 
                  komisi = komisi + ? 
              WHERE id_karyawan = ?`;

            connection.query(updateKomisiSql, [komisi, komisi, item.id_karyawan], (err, results) => {
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

// Get Transaksi by ID v
app.get('/transaksi/:id', (req, res) => {
  const id = req.params.id;
  const sqlTransaksi = 'SELECT * FROM transaksi WHERE id_transaksi = ?';
  const sqlItems = 'SELECT * FROM item_transaksi WHERE id_transaksi = ?';

  connection.query(sqlTransaksi, [id], (err, transaksiResults) => {
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

// Get Transaksi by Cabang v
app.get('/transaksi/cabang/:id_cabang', (req, res) => {
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM transaksi WHERE id_cabang = ?';

  connection.query(sql, [id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving transactions!');
      throw err;
    }

    res.send(results);
  });
});

// Get Transaksi by Date
app.get('/transaksi/date/:date', (req, res) => {
  const date = req.params.date;
  const sql = 'SELECT * FROM transaksi WHERE DATE(created_at) = ?';

  connection.query(sql, [date], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving transactions!');
      throw err;
    }

    res.send(results);
  });
});


// Create Transaction Draft
app.post('/transaksi/draft', (req, res) => {
  const { nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, items } = req.body;
  const status = 1; // Draft
  const sqlTransaksi = id_member
    ? 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, status) VALUES (?, ?, ?, ?, ?, ?)'
    : 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, status) VALUES (?, ?, ?, ?, ?)';

  const params = id_member
    ? [nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, status]
    : [nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, status];

  connection.query(sqlTransaksi, params, (err, results) => {
    if (err) {
      res.status(500).send('Error creating transaction draft!');
      throw err;
    }

    const id_transaksi = results.insertId;

    const sqlItemTransaksi = 'INSERT INTO item_transaksi (id_transaksi, id_layanan, catatan, harga, id_karyawan, created_at) VALUES ?';
    const currentDate = new Date();
    const values = items.map(item => [
      id_transaksi,
      item.id_layanan,
      item.catatan,
      item.harga,
      item.id_karyawan,
      currentDate
    ]);

    connection.query(sqlItemTransaksi, [values], (err, results) => {
      if (err) {
        res.status(500).send('Error creating transaction items!');
        throw err;
      }

      res.send('Transaction draft and items created successfully!');
    });
  });
});

// Continue Draft
app.put('/transaksi/draft/:id', (req, res) => {
  const id = req.params.id;
  const { total_harga, metode_pembayaran, items } = req.body;
  const status = 'completed';

  const sqlUpdateTransaksi = 'UPDATE transaksi SET total_harga = ?, metode_pembayaran = ?, status = ? WHERE id_transaksi = ?';
  connection.query(sqlUpdateTransaksi, [total_harga, metode_pembayaran, status, id], (err, results) => {
    if (err) {
      res.status(500).send('Error updating transaction draft!');
      throw err;
    }

    const sqlDeleteItems = 'DELETE FROM item_transaksi WHERE id_transaksi = ?';
    connection.query(sqlDeleteItems, [id], (err, results) => {
      if (err) {
        res.status(500).send('Error deleting old transaction items!');
        throw err;
      }

      const sqlInsertItems = 'INSERT INTO item_transaksi (id_transaksi, id_layanan, catatan, harga, id_karyawan, created_at) VALUES ?';
      const currentDate = new Date();
      const values = items.map(item => [
        id,
        item.id_layanan,
        item.catatan,
        item.harga,
        item.id_karyawan,
        currentDate
      ]);

      connection.query(sqlInsertItems, [values], (err, results) => {
        if (err) {
          res.status(500).send('Error creating new transaction items!');
          throw err;
        }

        res.send('Transaction draft continued and items updated successfully!');
      });
    });
  });
});

// CRUD Karyawan
app.post('/karyawan', (req, res) => {
  const { nama_karyawan, alamat, nomor_telepon, id_cabang } = req.body;
  const sql = 'INSERT INTO karyawan (nama_karyawan, alamat, nomor_telepon, id_cabang) VALUES (?, ?, ?, ?)';
  connection.query(sql, [nama_karyawan, alamat, nomor_telepon, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error creating karyawan!');
      throw err;
    }
    res.send('Karyawan created!');
  });
});

app.get('/karyawan/:id_cabang', (req, res) => {
  const id_cabang = req.params.id_cabang;
  const sql = 'SELECT * FROM karyawan WHERE id_cabang = ?';
  connection.query(sql, [id_cabang], (err, results) => {
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
  connection.query(sql, [nama_karyawan, alamat, nomor_telepon, id_cabang, id], (err, results) => {
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
  connection.query(sql, [id], (err, results) => {
    if (err) {
      res.status(500).send('Error deleting karyawan!');
      throw err;
    }
    res.send('Karyawan deleted!');
  });
});

// Clear Daily Commission
app.post('/komisi/clear_daily', (req, res) => {
  const sql = `
    UPDATE karyawan
    SET komisi_harian = 0
  `;

  connection.query(sql, (err, result) => {
    if (err) {
      console.error('Error clearing daily commissions:', err);
      res.status(500).send('Error clearing daily commissions!');
      return;
    }

    res.send({ message: 'Daily commissions cleared successfully!' });
  });
});

// Clear Monthly Commission
app.post('/komisi/clear_monthly', (req, res) => {
  const sql = `
    UPDATE karyawan
    SET komisi = 0
  `;

  connection.query(sql, (err, result) => {
    if (err) {
      console.error('Error clearing daily commissions:', err);
      res.status(500).send('Error clearing daily commissions!');
      return;
    }

    res.send({ message: 'Daily commissions cleared successfully!' });
  });
});

// CRUD Layanan
// add layanan
app.post('/layanan', (req, res) => {
  const { nama_layanan, persen_komisi, persen_komisi_luarjam, kategori } = req.body;
  const sql = 'INSERT INTO layanan (nama_layanan, persen_komisi, persen_komisi_luarjam, kategori) VALUES (?, ?, ?, ?)';
  connection.query(sql, [nama_layanan, persen_komisi, persen_komisi_luarjam, kategori], (err, results) => {
    if (err) {
      console.error('Error creating layanan:', err);
      res.status(500).json({ error: 'Error creating layanan!' });
      return;
    }
    res.status(201).json({ message: 'Layanan created!', id_layanan: results.insertId });
  });
});

// get all layanan
app.get('/layanan', (req, res) => {
  const sql = 'SELECT * FROM layanan';
  connection.query(sql, (err, results) => {
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
  connection.query(sql, [id_layanan], (err, results) => {
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


// edit layanan
app.put('/layanan/:id', (req, res) => {
  const id_layanan = req.params.id;
  const { nama_layanan, persen_komisi, persen_komisi_luarjam, kategori } = req.body;
  const sql = 'UPDATE layanan SET nama_layanan = ?, persen_komisi = ?, persen_komisi_luarjam = ?, kategori = ? WHERE id_layanan = ?';
  connection.query(sql, [nama_layanan, persen_komisi, persen_komisi_luarjam, kategori, id_layanan], (err, results) => {
    if (err) {
      console.error('Error updating layanan:', err);
      res.status(500).json({ error: 'Error updating layanan!' });
      return;
    }
    res.status(200).json({ message: 'Layanan updated!', id_layanan: id_layanan });
  });
});

// delete layanan
app.delete('/layanan/:id', (req, res) => {
  const id_layanan = req.params.id;
  const sql = 'DELETE FROM layanan WHERE id_layanan = ?';
  connection.query(sql, [id_layanan], (err, results) => {
    if (err) {
      console.error('Error deleting layanan:', err);
      res.status(500).json({ error: 'Error deleting layanan!' });
      return;
    }
    res.status(200).json({ message: 'Layanan deleted!', id_layanan: id_layanan });
  });
});


// CRUD Pelanggan
app.post('/pelanggan', (req, res) => {
  const { nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang } = req.body;
  const sql = 'INSERT INTO members (nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang) VALUES (?, ?, ?, ?, ?, ?)';
  connection.query(sql, [nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang], (err, results) => {
    if (err) {
      res.status(500).send('Error creating pelanggan!');
      throw err;
    }
    res.send('Pelanggan created!');
  });
});

app.get('/pelanggan', (req, res) => {
  const sql = 'SELECT * FROM members';
  connection.query(sql, (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving pelanggan!');
      throw err;
    }
    res.send(results);
  });
});

app.put('/pelanggan/:id', (req, res) => {
  const id = req.params.id;
  const { nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang } = req.body;
  const sql = 'UPDATE members SET nama_member = ?, nomor_telepon = ?, alamat = ?, tanggal_lahir = ?, tanggal_daftar = ?, id_cabang = ? WHERE id_member = ?';
  connection.query(sql, [nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang, id], (err, results) => {
    if (err) {
      res.status(500).send('Error updating pelanggan!');
      throw err;
    }
    res.send('Pelanggan updated!');
  });
});

app.delete('/pelanggan/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'DELETE FROM members WHERE id_member = ?';
  connection.query(sql, [id], (err, results) => {
    if (err) {
      res.status(500).send('Error deleting pelanggan!');
      throw err;
    }
    res.send('Pelanggan deleted!');
  });
});

// Count Money by Metode Pembayaran
app.get('/money/metode/:metode', (req, res) => {
  const metode = req.params.metode;
  const sql = 'SELECT SUM(total_harga) AS total_money FROM transaksi WHERE metode_pembayaran = ?';

  connection.query(sql, [metode], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving total money!');
      throw err;
    }

    res.send(results[0]);
  });
});

// Count Money by Date
app.get('/money/date/:date', (req, res) => {
  const date = req.params.date;
  const sql = 'SELECT SUM(total_harga) AS total_money FROM transaksi WHERE DATE(created_at) = ?';

  connection.query(sql, [date], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving total money!');
      throw err;
    }

    res.send(results[0]);
  });
});

// Login Pemilik
app.post('/login/pemilik', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM pemilik WHERE username = ? AND password = ?';

  connection.query(sql, [username, password], (err, results) => {
    if (err) {
      res.status(500).send('Error logging in!');
      throw err;
    }

    if (results.length === 0) {
      res.status(401).send('Invalid credentials!');
      return;
    }

    res.send('Login successful!');
  });
});

// Login Cabang
app.post('/login/cabang', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM cabang WHERE username = ? AND password = ?';

  connection.query(sql, [username, password], (err, results) => {
    if (err) {
      res.status(500).send('Error logging in!');
      throw err;
    }

    if (results.length === 0) {
      res.status(401).send('Invalid credentials!');
      return;
    }

    res.send('Login successful!');
  });
});

// Search Layanan
app.get('/search/layanan', (req, res) => {
  const { keyword } = req.query;
  const sql = 'SELECT * FROM layanan WHERE nama_layanan LIKE ?';
  const search = `%${keyword}%`;

  connection.query(sql, [search], (err, results) => {
    if (err) {
      res.status(500).send('Error searching layanan!');
      throw err;
    }

    res.send(results);
  });
});

// Search Pelanggan
app.get('/search/pelanggan', (req, res) => {
  const { keyword } = req.query;
  const sql = 'SELECT * FROM members WHERE nama_member LIKE ?';
  const search = `%${keyword}%`;

  connection.query(sql, [search], (err, results) => {
    if (err) {
      res.status(500).send('Error searching pelanggan!');
      throw err;
    }

    res.send(results);
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
