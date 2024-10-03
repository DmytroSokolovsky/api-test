var Express = require("express")
var cors = require("cors")
var multer = require("multer")
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');

var app = Express()
app.use(cors())
app.use(bodyParser.json());

var CONNECTION_STRING = "mongodb+srv://dmitriy_2406:Raketa123@cluster0.vx5nh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"

var DATABASENAME = "hospital"
var database;

app.listen(5038, () => {
  MongoClient.connect(CONNECTION_STRING, (error, client) => {
    database = client.db(DATABASENAME)
    console.log("Started");
  })
})


app.get('/specializations', async (request, response) => {
  try {
    const specializations = await database.collection('doctors').distinct("specialization");
    response.json(specializations);
  } catch (error) {
    console.error("Ошибка при получении специализаций:", error);
    request.status(500).json({ message: 'Ошибка сервера при получении специализаций' });
  }
});

app.get('/doctors/:specialization', async (req, res) => {
  try {
    const specialization = req.params.specialization;
    const doctors = await database.collection('doctors').find({ specialization }).toArray();
    res.json(doctors);
  } catch (error) {
    console.error("Ошибка при получении врачей:", error);
    res.status(500).json({ message: 'Ошибка сервера при получении врачей' });
  }
});

app.get('/doctor/:id/schedule', async (request, response) => {
  try {
    const doctorId = request.params.id;
    const doctor = await database.collection('doctors').findOne({ _id: new ObjectId(doctorId) });

    if (!doctor) {
      return response.status(404).json({ message: 'Врач не найден' });
    }

    const availableDates = doctor.schedule.filter(day => 
      day.time_slots.some(slot => slot.is_available)
    );

    response.json(availableDates); 
  } catch (error) {
    console.error("Ошибка при получении графика врача:", error);
    response.status(500).json({ message: 'Ошибка сервера при получении графика врача' });
  }
});

app.get('/doctor/:id/schedule/:date', async (request, response) => {
  try {
    const doctorId = request.params.id;
    const date = request.params.date;
    const doctor = await database.collection('doctors').findOne({ _id: new ObjectId(doctorId) });

    if (!doctor) {
      return response.status(404).json({ message: 'Врач не найден' });
    }

    const selectedDay = doctor.schedule.find(day => day.day === date);

    if (!selectedDay) {
      return response.status(404).json({ message: 'Дата не найдена' });
    }

    const availableSlots = selectedDay.time_slots.filter(slot => slot.is_available);

    response.json(availableSlots);
  } catch (error) {
    console.error("Ошибка при получении доступных временных слотов:", error);
    response.status(500).json({ message: 'Ошибка сервера при получении доступных временных слотов' });
  }
});

app.post('/records', async (req, res) => {
  try {
    const {
      doctor,
      doctor_id,
      specialization,
      date,
      time,
      user_id,
      patient_name,
      patient_phone_number,
    } = req.body;

    const newRecord = {
      doctor,
      doctor_id,
      specialization,
      date,
      time,
      user_id,
      patient_name,
      patient_phone_number,
    };

    await database.collection('records').insertOne(newRecord);

    const updateResult = await database.collection('doctors').updateOne(
      { 
        name: doctor, 
        "schedule.day": date 
      },
      {
        $set: {
          "schedule.$[dateElem].time_slots.$[slotElem].is_available": false,
        }
      },
      {
        arrayFilters: [
          { "dateElem.day": date }, 
          { "slotElem.time": time } 
        ]
      }
    );

    if (updateResult.modifiedCount === 0) {
      console.log("Не удалось обновить временной слот, возможно он уже недоступен или неправильные данные.");
    } else {
      console.log("Временной слот успешно обновлен.");
    }

    res.status(201).json(newRecord);
  } catch (error) {
    console.error("Ошибка при добавлении записи:", error);
    res.status(500).json({ message: 'Ошибка сервера при добавлении записи' });
  }
});

app.get('/records/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params; 
    const userId = parseInt(user_id, 10); 

    const records = await database.collection('records').find({ user_id: userId }).toArray(); 

    if (records.length === 0) {
      return res.status(404).json({ message: 'Записи не найдены' });
    }

    res.json(records); 
  } catch (error) {
    console.error("Ошибка при получении записей:", error);
    res.status(500).json({ message: 'Ошибка сервера при получении записей' });
  }
});

app.delete('/records/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const record = await database.collection('records').findOne({ _id: new ObjectId(id) });

    if (!record) {
      return res.status(404).json({ message: 'Запись не найдена' });
    }

    const deleteResult = await database.collection('records').deleteOne({ _id: new ObjectId(id) });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ message: 'Запись не найдена' });
    }

    const { doctor_id, date, time } = record;

    const updateResult = await database.collection('doctors').updateOne(
      { telegram_id: doctor_id, 'schedule.day': date, 'schedule.time_slots.time': time },
      { $set: { 'schedule.$[day].time_slots.$[slot].is_available': true } },
      {
        arrayFilters: [
          { 'day.day': date }, 
          { 'slot.time': time } 
        ]
      }
    );

    if (updateResult.modifiedCount === 0) {
      console.warn("Не удалось обновить график врача, возможно, временной слот не найден.");
    }

    res.status(204).send(); 
  } catch (error) {
    console.error("Ошибка при удалении записи и обновлении графика врача:", error);
    res.status(500).json({ message: 'Ошибка сервера при удалении записи' });
  }
});


app.get('/doctor/:id/available-dates', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.id, 10);
    const records = await database.collection('records').find({ doctor_id: doctorId }).toArray();
    const uniqueDates = [...new Set(records.map(record => record.date))];

    if (uniqueDates.length === 0) {
      return res.status(404).json({ message: 'Нет доступных дат' });
    }

    res.json(uniqueDates);
  } catch (error) {
    console.error("Ошибка при получении доступных дат:", error);
    res.status(500).json({ message: 'Ошибка сервера при получении доступных дат' });
  }
});

app.get('/doctor/:id/records/:date', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.id, 10);
    const date = req.params.date;

    const records = await database.collection('records').find({ doctor_id: doctorId, date }).toArray();

    if (records.length === 0) {
      return res.status(404).json({ message: 'Записи не найдены для данной даты' });
    }

    res.json(records);
  } catch (error) {
    console.error("Ошибка при получении записей для врача:", error);
    res.status(500).json({ message: 'Ошибка сервера при получении записей для врача' });
  }
});