import mysql2 from 'mysql2';

/**
 * Loads data from Aurora using provided query
 * @param dbConfig connection config
 * @param sql "select" SQL query to execute
 */
export async function loadData(dbConfig: string, sql: string) {
  const connection = mysql2.createConnection(dbConfig);
  const [rows] = await connection.promise().query(sql);
  return rows;
}
