# Manual de uso — Kinesiología Integral

## Índice

1. [Inicio de sesión](#1-inicio-de-sesión)
2. [Pantalla principal](#2-pantalla-principal)
3. [Pacientes](#3-pacientes)
   - [Ver la lista de pacientes](#31-ver-la-lista-de-pacientes)
   - [Registrar un nuevo paciente](#32-registrar-un-nuevo-paciente)
   - [Editar un paciente](#33-editar-un-paciente)
   - [Tratamientos y sesiones](#34-tratamientos-y-sesiones)
   - [Historial libre](#35-historial-libre)
   - [Turnos del paciente](#36-turnos-del-paciente)
   - [Enviar recordatorio por WhatsApp](#37-enviar-recordatorio-por-whatsapp)
   - [Eliminar un paciente](#38-eliminar-un-paciente)
4. [Calendario](#4-calendario)
   - [Navegación del mes](#41-navegación-del-mes)
   - [Agenda del día](#42-agenda-del-día)
   - [Crear un turno nuevo](#43-crear-un-turno-nuevo)
   - [Editar un turno](#44-editar-un-turno)
   - [Confirmar asistencia desde el calendario](#45-confirmar-asistencia-desde-el-calendario)
   - [Filtros y búsqueda](#46-filtros-y-búsqueda)
   - [Feriados nacionales](#47-feriados-nacionales)
5. [Libro Diario](#5-libro-diario)

---

## 1. Inicio de sesión

Al ingresar a la aplicación se muestra una pantalla de login. Ingresá tu mail y contraseña institucional (por ejemplo `karina@kinesiologia.com.ar`) y hacé click en **Ingresar**.

Una vez dentro, tu nombre aparece en la esquina superior derecha junto al ícono de usuario. Para cerrar sesión usá el botón **Salir** que está al lado de tu nombre.

---

## 2. Pantalla principal

La aplicación tiene dos secciones principales accesibles desde las pestañas superiores:

| Pestaña | Qué contiene |
|---|---|
| **Pacientes** | Lista de todos los pacientes registrados |
| **Calendario** | Agenda mensual con los turnos |

Hay una tercer sección accesible desde el menú:

| Sección | Qué contiene |
|---|---|
| **Libro Diario** | Registro diario de pacientes atendidos |

---

## 3. Pacientes

### 3.1 Ver la lista de pacientes

La pestaña **Pacientes** muestra una tabla con todos los pacientes ordenados alfabéticamente. Desde la barra de búsqueda en la parte superior podés filtrar por nombre, apellido, DNI u obra social escribiendo en tiempo real.

Cada fila muestra:
- Nombre y apellido
- Obra social y N° de afiliado
- Diagnóstico y médico tratante
- Badge de sesiones usadas vs. autorizadas (si tiene tratamiento activo)

La lista está paginada. Usá los botones de navegación al pie para pasar de página.

---

### 3.2 Registrar un nuevo paciente

1. Hacé click en el botón **Nuevo paciente** (esquina superior derecha de la pestaña Pacientes).
2. Completá los datos en el formulario:

**Datos personales**
- Nombre y apellido *(requeridos)*
- Sexo
- DNI y edad *(requeridos)*
- Domicilio y teléfono

**Cobertura**
- Obra social *(requerida)*
- N° de afiliado (AFL)

**Médico**
- Diagnóstico y doctor *(requeridos)*

**Notas**
- Anotaciones generales
- Descripción del tratamiento médico (campo libre)

**Tratamientos** — ver sección [3.4](#34-tratamientos-y-sesiones)

**Historial libre** — ver sección [3.5](#35-historial-libre)

3. Hacé click en **Registrar** para guardar.

> Si ya hay sesiones registradas en el mismo día, el sistema las agrupa automáticamente en el Libro Diario sin duplicar.

---

### 3.3 Editar un paciente

1. En la lista de pacientes, hacé click en el ícono de **lápiz** (✏️) de la fila del paciente.
2. Se abre el modal de edición con todos los datos cargados.
3. Modificá lo que necesites.
4. Hacé click en **Guardar Cambios**.

El campo **Última actualización** al pie del formulario muestra quién y cuándo guardó por última vez.

---

### 3.4 Tratamientos y sesiones

Cada paciente puede tener uno o más tratamientos. Cada tratamiento representa una autorización de la obra social.

#### Crear un tratamiento

1. Dentro del modal de edición (o creación), en la sección **Tratamientos**, hacé click en **Nuevo tratamiento**.
2. Completá:
   - **N° autorización**: el código que entrega la obra social (puede dejarse vacío y completarse después).
   - **Sesiones autorizadas**: la cantidad de sesiones que autorizó la obra social (ej: 10).
3. Hacé click en **Crear**.

El tratamiento aparece como una fila expandible (accordion).

#### Ver y editar un tratamiento

Hacé click sobre la fila del tratamiento para expandirlo. Dentro vas a ver:

- **N° autorización** — campo editable en cualquier momento (útil cuando la autorización llega después de empezar el tratamiento).
- Cantidad de sesiones autorizadas.
- Lista de sesiones registradas con su fecha y hora.
- Botón **Nueva sesión** para agregar una sesión manualmente.

El badge junto al nombre del tratamiento muestra `sesiones usadas / autorizadas` y cambia de color:
- 🟢 Verde: quedan sesiones disponibles
- 🟠 Naranja: usadas el 80% o más
- 🔴 Rojo: sesiones agotadas o superadas

#### Agregar una sesión manualmente

Dentro del tratamiento expandido, hacé click en **Nueva sesión**. Se registra automáticamente con la fecha y hora actual (horario Argentina).

#### Eliminar una sesión

Dentro del tratamiento expandido, hacé click en la **X** al lado de la sesión que querés quitar.

> **Nota importante:** cuando se confirma la asistencia de un turno desde el Calendario, la sesión se registra automáticamente en el último tratamiento activo del paciente. Ver sección [4.5](#45-confirmar-asistencia-desde-el-calendario).

---

### 3.5 Historial libre

Debajo de la sección de Tratamientos hay un campo de texto editable llamado **Historial libre**. Es un espacio de texto sin formato donde podés anotar lo que necesites, como notas clínicas, evolución del paciente, etc.

No tiene estructura obligatoria — escribís libremente y se guarda con el paciente.

---

### 3.6 Turnos del paciente

Dentro del modal de edición, en la sección **Turnos agendados**, se muestran todos los turnos futuros y recientes del paciente ordenados por fecha. Desde ahí podés:

- Ver el estado de cada turno (pendiente, asistió, ausente, cancelado).
- Ver si una ausencia fue justificada o no.
- **Eliminar un turno individual** con el ícono de papelera.
- **Eliminar todos los turnos** del paciente con el botón "Eliminar todos" (pide confirmación).

---

### 3.7 Enviar recordatorio por WhatsApp

Si el paciente tiene número de teléfono cargado, aparece el botón **WhatsApp** en la sección de Turnos agendados.

Al hacer click se abre WhatsApp Web (o la app) con un mensaje pre-armado que lista todos los turnos **pendientes** del paciente ordenados por fecha, con el día completo y el horario. El mensaje incluye los datos del consultorio al final.

> Ejemplo de mensaje generado:
> ```
> Hola María, te recordamos tus turnos agendados:
>
> • Lunes 12 de mayo a las 09:00
> • Miércoles 14 de mayo a las 09:00
>
> Kinesiología Integral
> Lic. Ana Patricia Tullio
> 📞 02320-659087
> ```

---

### 3.8 Eliminar un paciente

1. En la lista de pacientes, hacé click en el ícono de **papelera** (🗑️) de la fila.
2. Se abre un diálogo de confirmación con el nombre del paciente.
3. Confirmá para eliminar definitivamente.

> Esta acción es irreversible. Los turnos del paciente en el calendario **no** se eliminan automáticamente.

---

## 4. Calendario

El calendario tiene un diseño dividido en dos partes:

- **Izquierda**: mini-calendario mensual compacto para navegar por el mes.
- **Derecha**: agenda del día seleccionado con todos los turnos hora por hora.

---

### 4.1 Navegación del mes

En el mini-calendario de la izquierda:

- Las flechas **‹** y **›** cambian de mes.
- El botón **Hoy** (aparece cuando no estás en el mes actual) vuelve al mes y día de hoy.
- Hacé click en cualquier día para ver su agenda en el panel derecho.
- Cada día muestra un badge con la cantidad de turnos activos (no cancelados):
  - 🔵 Azul: 1–15 turnos
  - 🟡 Amarillo: 16–25 turnos
  - 🔴 Rojo: 26 o más turnos
- Un **punto naranja** en la esquina superior derecha de un día indica que es **feriado nacional**.

El encabezado del mes muestra un resumen rápido:
- Cantidad de turnos pendientes, que asistieron y ausentes en ese mes.
- Si el día seleccionado es de otro mes, aparece un link directo para ir a ese mes.

---

### 4.2 Agenda del día

El panel derecho muestra el día seleccionado con una grilla hora por hora desde las 8:00 hasta las 19:00 (o más si hay turnos fuera de ese rango).

- Las franjas **con turno** muestran el nombre del paciente, horario y estado.
- Las franjas **vacías** muestran el texto "+ Agregar turno" y al hacer click abren el formulario de nuevo turno en ese horario.
- El encabezado muestra el día completo (ej: "martes 7 de mayo") con la etiqueta **Hoy** si corresponde, y la cantidad total de turnos.
- Las flechas **‹** y **›** al costado del título navegan al día anterior o siguiente.

---

### 4.3 Crear un turno nuevo

**Opción 1**: Hacé click en una franja horaria vacía en la agenda del día → se abre el modal con ese horario pre-cargado.

**Opción 2**: Hacé click en el botón **+ Nuevo turno** en el encabezado de la agenda → se abre el modal en el primer horario libre del día.

En el formulario de nuevo turno:
- Buscá al paciente por nombre o apellido.
- Ajustá el horario si hace falta.
- Elegí si es un turno único o configurá la **repetición**:
  - **Semanal por cantidad de semanas**: se repite cada X semanas.
  - **Semanal por cantidad de turnos**: se generan N turnos los mismos días.
  - **Por días de la semana**: elegís los días (ej: lunes y miércoles) por un período.
- Los feriados nacionales se excluyen automáticamente de la repetición.
- La vista previa muestra todas las fechas que se van a crear, marcando con tachado las que caen en feriado y se omiten.

---

### 4.4 Editar un turno

Hacé click sobre cualquier turno en la agenda del día para abrir el modal de edición.

Desde ahí podés:
- Cambiar el **horario**.
- Cambiar el **estado**: Pendiente / Asistió / Ausente / Cancelado.
- Si el estado es **Ausente**, indicar si la falta fue justificada o no.
- Agregar o editar **notas** del turno.
- **Eliminar** el turno (ícono de papelera, pide confirmación).

> Si el turno ya fue confirmado como "Asistió" mediante el botón de confirmación, el estado queda bloqueado y no se puede cambiar.

---

### 4.5 Confirmar asistencia desde el calendario

Cuando un turno está vinculado a un paciente registrado en el sistema, el modal de edición muestra una sección especial arriba:

> **¿El paciente asistió?** — Registra la sesión automáticamente en el historial.

Al hacer click en **Confirmar**:

1. El turno pasa al estado **Asistió**.
2. Se registra una entrada en el **Libro Diario** del día (si el paciente no tiene entrada ya).
3. Se agrega automáticamente una sesión al **último tratamiento activo** del paciente con la fecha y hora del turno.
4. Se actualiza también el **historial libre** del paciente.

Si el turno ya fue confirmado, aparece el ícono ✅ y el estado queda bloqueado.

---

### 4.6 Filtros y búsqueda

En la agenda del día, cuando hay turnos, aparece una barra de filtros:

- **Chips de estado**: filtrá por Pendiente, Asistió, Ausente o Cancelado. Cada chip muestra la cantidad de turnos en ese estado.
- **Búsqueda por nombre**: escribí el nombre o apellido del paciente para filtrar en tiempo real.
- Al filtrar, la grilla muestra solo las horas con coincidencias (no filas vacías).
- El botón **Limpiar** quita todos los filtros activos.

---

### 4.7 Feriados nacionales

El calendario carga automáticamente los feriados nacionales de Argentina para el año en curso y el siguiente. Se muestran de dos formas:

- **Punto naranja** en el mini-calendario sobre el día.
- **Banner amarillo** en la agenda del día con el nombre del feriado (ej: "Feriado nacional — Día del Trabajador").

Al crear turnos con repetición, los feriados se saltan automáticamente.

---

## 5. Libro Diario

El Libro Diario registra automáticamente cada vez que se confirma la asistencia de un paciente o se agrega una sesión manualmente. Es un registro diario de atenciones.

Cada entrada del día muestra:
- Nombre y apellido del paciente.
- Obra social.
- Columnas de **Debe** y **Haber** para anotaciones contables (editables).

El sistema evita duplicar entradas: si un paciente ya tiene una entrada para ese día, no se agrega nuevamente aunque se confirme otro turno.

---

*Manual generado para uso interno de Kinesiología Integral.*
