// openAI.js
import axios from 'axios';

export async function analyzeFinancialText(text, openAIKey) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12 ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.',
        },
        { role: 'user', content: `Analise este documento financeiro:\n\n${text}` },
      ],
    },
    { headers: { Authorization: `Bearer ${openAIKey}` } }
  );

  const content = response.data.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Resposta da OpenAI não contém JSON válido.');

  return JSON.parse(jsonMatch[0]);
}
