const express = require('express');
const mysql = require('mysql');
const app = express();
const bcrypt = require('bcrypt');
const saltRounds = 10;

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

// Register endpoint v
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

// Login endpoint v
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const sql = 'SELECT * FROM users WHERE username = ?';
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

      res.send('Login successful!');
    });
  });
});

// Create Transaction (Completed or Draft) v
app.post('/transaksi', (req, res) => {
  const { nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, id_cabang, items} = req.body;
  const status = 0; // Completed

  // Check if id_member exists
  if (id_member) {
    connection.query('SELECT id_member FROM members WHERE id_member = ?', [id_member], (err, results) => {
      if (err) {
        res.status(500).send('Error checking member!');
        return;
      }

      if (results.length === 0) {
        res.status(400).send('Member not found!');
        return;
      }

      createTransaction();
    });
  } else {
    createTransaction();
  }

  function createTransaction() {
    const sqlTransaksi = 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, id_cabang, status) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const params = [nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, id_cabang, status];

    connection.query(sqlTransaksi, params, (err, results) => {
      if (err) {
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
          res.status(500).send('Error creating transaction items!');
          throw err;
        }

        res.send('Transaction and items created successfully!');
      });
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

// CRUD Layanan
app.post('/layanan', (req, res) => {
  const { nama_layanan, harga } = req.body;
  const sql = 'INSERT INTO layanan (nama_layanan, harga) VALUES (?, ?)';
  connection.query(sql, [nama_layanan, harga], (err, results) => {
    if (err) {
      res.status(500).send('Error creating layanan!');
      throw err;
    }
    res.send('Layanan created!');
  });
});

app.get('/layanan', (req, res) => {
  const sql = 'SELECT * FROM layanan';
  connection.query(sql, (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving layanan!');
      throw err;
    }
    res.send(results);
  });
});

app.put('/layanan/:id', (req, res) => {
  const id = req.params.id;
  const { nama_layanan, harga } = req.body;
  const sql = 'UPDATE layanan SET nama_layanan = ?, harga = ? WHERE id_layanan = ?';
  connection.query(sql, [nama_layanan, harga, id], (err, results) => {
    if (err) {
      res.status(500).send('Error updating layanan!');
      throw err;
    }
    res.send('Layanan updated!');
  });
});

app.delete('/layanan/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'DELETE FROM layanan WHERE id_layanan = ?';
  connection.query(sql, [id], (err, results) => {
    if (err) {
      res.status(500).send('Error deleting layanan!');
      throw err;
    }
    res.send('Layanan deleted!');
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

// Read Komisi Karyawan by Date
app.get('/komisi/:date', (req, res) => {
  const date = req.params.date;
  const sql = 'SELECT karyawan.id_karyawan, karyawan.nama_karyawan, SUM(item_transaksi.harga) AS total_komisi FROM item_transaksi JOIN karyawan ON item_transaksi.id_karyawan = karyawan.id_karyawan WHERE DATE(item_transaksi.created_at) = ? GROUP BY karyawan.id_karyawan';

  connection.query(sql, [date], (err, results) => {
    if (err) {
      res.status(500).send('Error retrieving komisi karyawan!');
      throw err;
    }

    res.send(results);
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
