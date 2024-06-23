const express = require('express');
const app = express();
const mysql = require('mysql');

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

app.use(express.json());

//create transaksi
app.post('/transaksi', (req, res) => {
  const { nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, items, draft } = req.body;

  connection.beginTransaction(err => {
    if (err) throw err;

    if (id_member) {
      const sqlCheckMember = 'SELECT id_member, nama_member, nomor_telepon FROM member WHERE id_member = ?';
      connection.query(sqlCheckMember, [id_member], (err, results) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).send('Error checking member!');
            throw err;
          });
        }

        if (results.length === 0) {
          insertTransaction(false);
        } else {
          insertTransaction(true, results[0].nama_member, results[0].nomor_telepon);
        }
      });
    } else {
      insertTransaction(false);
    }

    function insertTransaction(withMember, memberName, memberPhone) {
      const sqlTransaksi = withMember
        ? 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, draft) VALUES (?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO transaksi (nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, draft) VALUES (?, ?, ?, ?, ?)';

      const params = withMember
        ? [memberName, memberPhone, total_harga, metode_pembayaran, id_member, draft]
        : [nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, draft];

      connection.query(sqlTransaksi, params, (err, results) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).send('Error creating transaction!');
            throw err;
          });
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
            return connection.rollback(() => {
              res.status(500).send('Error creating transaction items!');
              throw err;
            });
          }

          connection.commit(err => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).send('Error committing transaction!');
                throw err;
              });
            }
            res.send('Transaction and items created successfully!');
          });
        });
      });
    }
  });
});

//put transaksi
app.put('/transaksi/:id', (req, res) => {
  const { id } = req.params;
  const { nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, id_member, items, draft } = req.body;

  connection.beginTransaction(err => {
    if (err) throw err;

    if (id_member) {
      const sqlCheckMember = 'SELECT id_member, nama_member, nomor_telepon FROM member WHERE id_member = ?';
      connection.query(sqlCheckMember, [id_member], (err, results) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).send('Error checking member!');
            throw err;
          });
        }

        if (results.length === 0) {
          updateTransaction(false);
        } else {
          updateTransaction(true, results[0].nama_member, results[0].nomor_telepon);
        }
      });
    } else {
      updateTransaction(false);
    }

    function updateTransaction(withMember, memberName, memberPhone) {
      const sqlTransaksi = withMember
        ? 'UPDATE transaksi SET nama_pelanggan = ?, nomor_telepon = ?, total_harga = ?, metode_pembayaran = ?, id_member = ?, draft = ? WHERE id_transaksi = ?'
        : 'UPDATE transaksi SET nama_pelanggan = ?, nomor_telepon = ?, total_harga = ?, metode_pembayaran = ?, draft = ? WHERE id_transaksi = ?';

      const params = withMember
        ? [memberName, memberPhone, total_harga, metode_pembayaran, id_member, draft, id]
        : [nama_pelanggan, nomor_telepon, total_harga, metode_pembayaran, draft, id];

      connection.query(sqlTransaksi, params, (err, results) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).send('Error updating transaction!');
            throw err;
          });
        }

        const sqlDeleteItems = 'DELETE FROM item_transaksi WHERE id_transaksi = ?';
        connection.query(sqlDeleteItems, [id], (err, results) => {
          if (err) {
            return connection.rollback(() => {
              res.status(500).send('Error deleting transaction items!');
              throw err;
            });
          }

          const sqlItemTransaksi = 'INSERT INTO item_transaksi (id_transaksi, id_layanan, catatan, harga, id_karyawan, created_at) VALUES ?';
          const currentDate = new Date();
          const values = items.map(item => [
            id,
            item.id_layanan,
            item.catatan,
            item.harga,
            item.id_karyawan,
            currentDate
          ]);

          connection.query(sqlItemTransaksi, [values], (err, results) => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).send('Error creating transaction items!');
                throw err;
              });
            }

            connection.commit(err => {
              if (err) {
                return connection.rollback(() => {
                  res.status(500).send('Error committing transaction!');
                  throw err;
                });
              }
              res.send('Transaction and items updated successfully!');
            });
          });
        });
      });
    }
  });
});

//get detail transaksi
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

    connection.query(sqlItems, [id], (err, itemsResults) => {
      if (err) {
        res.status(500).send('Error retrieving transaction items!');
        throw err;
      }

      const transaction = transaksiResults[0];
      transaction.items = itemsResults;

      res.send(transaction);
    });
  });
});

  
  // Get all transactions
  app.get('/transaksi', (req, res) => {
    connection.query('SELECT * FROM transaksi', (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Get transaction by ID with items
app.get('/transaksi/:id', (req, res) => {
  const id = req.params.id;
  const sql = `
      SELECT t.*, it.*
      FROM transaksi t
      LEFT JOIN item_transaksi it ON t.id_transaksi = it.id_transaksi
      WHERE t.id_transaksi = ?
  `;
  connection.query(sql, [id], (err, results) => {
      if (err) {
          res.status(500).send('Error retrieving transaction!');
          throw err;
      }

      if (results.length > 0) {
          const transaksi = {
              id_transaksi: results[0].id_transaksi,
              nama_pelanggan: results[0].nama_pelanggan,
              nomor_telepon: results[0].nomor_telepon,
              total_harga: results[0].total_harga,
              metode_pembayaran: results[0].metode_pembayaran,
              id_member: results[0].id_member,
              items: results.map(row => ({
                  id_item_transaksi: row.id_item_transaksi,
                  id_layanan: row.id_layanan,
                  catatan: row.catatan,
                  harga: row.harga,
                  id_karyawan: row.id_karyawan,
                  created_at: row.created_at,
                  updated_at: row.updated_at
              }))
          };
          res.send(transaksi);
      } else {
          res.status(404).send('Transaction not found!');
      }
  });
});
  
  // Create new layanan
  app.post('/layanan', (req, res) => {
    const nama_layanan = req.body.nama_layanan;
    const persen_komisi = req.body.persen_komisi;
    const persen_komisi_luarjam = req.body.persen_komisi_luarjam;
    const kategori = req.body.kategori;
  
    const sql = 'INSERT INTO layanan (nama_layanan, persen_komisi, persen_komisi_luarjam, kategori) VALUES (?,?,?,?)';
    connection.query(sql, [nama_layanan, persen_komisi, persen_komisi_luarjam, kategori], (err, results) => {
      if (err) throw err;
      res.send('Layanan created!');
    });
  });
  
  // Get all layanan
  app.get('/layanan', (req, res) => {
    connection.query('SELECT * FROM layanan', (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Get layanan by ID
  app.get('/layanan/:id', (req, res) => {
    const id = req.params.id;
    connection.query('SELECT * FROM layanan WHERE id_layanan =?', [id], (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Create new cabang
  app.post('/cabang', (req, res) => {
    const nama_cabang = req.body.nama_cabang;
    const alamat = req.body.alamat;
    const nomor_telepon = req.body.nomor_telepon;
  
    const sql = 'INSERT INTO cabang (nama_cabang, alamat, nomor_telepon) VALUES (?,?,?)';
    connection.query(sql, [nama_cabang, alamat, nomor_telepon], (err, results) => {
      if (err) throw err;
      res.send('Cabang created!');
    });
  });
  
  // Get all cabang
  app.get('/cabang', (req, res) => {
    connection.query('SELECT * FROM cabang', (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Get cabang by ID
  app.get('/cabang/:id', (req, res) => {
    const id = req.params.id;
    connection.query('SELECT * FROM cabang WHERE id_cabang =?', [id], (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Create new karyawan
  app.post('/karyawan', (req, res) => {
    const nama_karyawan = req.body.nama_karyawan;
    const alamat = req.body.alamat;
    const nomor_telepon = req.body.nomor_telepon;
    const id_cabang = req.body.id_cabang;
  
    const sql = 'INSERT INTO karyawan (nama_karyawan, alamat, nomor_telepon, id_cabang) VALUES (?,?,?,?)';
    connection.query(sql, [nama_karyawan, alamat, nomor_telepon, id_cabang], (err, results) => {
      if (err) throw err;
      res.send('Karyawan created!');
    });
  });
  
  // Get all karyawan
  app.get('/karyawan', (req, res) => {
    connection.query('SELECT * FROM karyawan', (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Get karyawan by ID
  app.get('/karyawan/:id', (req, res) => {
    const id = req.params.id;
    connection.query('SELECT * FROM karyawan WHERE id_karyawan =?', [id], (err, results) => {
      if (err) throw err;
      res.send(results);
    });
  });
  
  // Get all members
app.get('/member', (req, res) => {
  connection.query('SELECT * FROM member', (err, results) => {
      if (err) {
          res.status(500).send('Error retrieving members!');
          throw err;
      }
      res.send(results);
  });
});

// Get member by ID
app.get('/member/:id', (req, res) => {
  const id = req.params.id;
  connection.query('SELECT * FROM member WHERE id_member = ?', [id], (err, results) => {
      if (err) {
          res.status(500).send('Error retrieving member!');
          throw err;
      }
      res.send(results);
  });
});

// Create new member
app.post('/member', (req, res) => {
  const { nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang } = req.body;
  const sql = 'INSERT INTO member (nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang) VALUES (?, ?, ?, ?, ?, ?)';
  const params = [nama_member, nomor_telepon, alamat, tanggal_lahir, tanggal_daftar, id_cabang];
  connection.query(sql, params, (err, results) => {
      if (err) {
          res.status(500).send('Error creating member!');
          throw err;
      }
      res.send('Member created successfully!');
  });
});
  

  
  app.listen(3000, () => {
    console.log('Server started on port 3000');
  });