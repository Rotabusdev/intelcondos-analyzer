const express = require('express');
const app = express();

// Este é um código de teste simples que não faz nada além de responder.
// Ele não usa nenhuma API externa nem lógica complexa.

app.post('/api', (req, res) => {
  console.log('API DE TESTE SIMPLES FOI CHAMADA COM SUCESSO!');
  res.status(200).json({ message: 'A API de teste funcionou.' });
});

module.exports = app;