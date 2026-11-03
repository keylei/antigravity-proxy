/**
 * 伪造的 Q&A 对话数据
 * 用于 Trajectory Analytics 上报，模拟真实的编程对话轨迹。
 *
 * 来源：antigravity2api-nodejs/src/constants/index.js
 */
export const QA_PAIRS = [
    {
        question: '如何在Python中读取CSV文件？',
        answer: '你可以使用pandas库来读取CSV文件。首先安装pandas：pip install pandas，然后使用pd.read_csv()函数读取文件。示例代码：\n\nimport pandas as pd\ndf = pd.read_csv("data.csv")\nprint(df.head())'
    },
    {
        question: '解释JavaScript中的Promise是什么？',
        answer: 'Promise是JavaScript中处理异步操作的对象。它代表一个可能还没有完成的操作的最终结果。Promise有三种状态：pending（进行中）、fulfilled（已成功）和rejected（已失败）。你可以使用.then()处理成功结果，.catch()处理错误。'
    },
    {
        question: '如何在Git中创建新分支？',
        answer: '创建新分支有几种方式：\n1. git branch <branch-name> - 创建分支但不切换\n2. git checkout -b <branch-name> - 创建并切换到新分支\n3. git switch -c <branch-name> - Git 2.23+的新语法\n\n建议使用第2或第3种方式，可以一步完成创建和切换。'
    },
    {
        question: 'React中useState和useEffect的区别？',
        answer: 'useState用于在函数组件中添加状态管理，返回状态值和更新函数。useEffect用于处理副作用，如数据获取、订阅和DOM操作。useState在每次渲染时保持状态，useEffect在组件渲染后执行。它们是React中最常用的两个Hook。'
    },
    {
        question: '什么是SQL注入？如何防御？',
        answer: 'SQL注入是一种安全漏洞，攻击者通过在输入中插入恶意SQL代码来操纵数据库查询。防御方法包括：\n1. 使用参数化查询/预处理语句\n2. 输入验证和转义\n3. 使用ORM框架\n4. 最小权限原则\n5. WAF防火墙'
    },
    {
        question: '如何优化Python代码性能？',
        answer: '优化Python性能的常见方法：\n1. 使用列表推导式代替循环\n2. 选择合适的数据结构（dict查找O(1)）\n3. 使用生成器处理大数据集\n4. 利用内置函数（map, filter）\n5. 使用NumPy进行数值计算\n6. 考虑使用Cython或PyPy\n7. 使用functools.lru_cache缓存'
    },
    {
        question: 'Docker和虚拟机有什么区别？',
        answer: 'Docker容器和虚拟机的主要区别：\n- Docker共享主机操作系统内核，VM有独立的操作系统\n- Docker启动秒级，VM启动分钟级\n- Docker占用资源少，VM需要更多内存和存储\n- Docker使用镜像层叠，VM使用完整磁盘镜像\n- Docker适合微服务架构，VM适合需要完全隔离的场景'
    },
    {
        question: 'TypeScript中interface和type的区别？',
        answer: 'interface和type在TypeScript中都可以定义类型，主要区别：\n1. interface可以被extends和implements，type用交叉类型(&)\n2. interface可以声明合并（同名自动合并），type不行\n3. type可以定义联合类型、元组、基本类型别名\n4. interface只能定义对象类型\n通常推荐优先使用interface，需要联合类型时用type。'
    },
    {
        question: '解释RESTful API的设计原则',
        answer: 'RESTful API设计原则：\n1. 使用HTTP方法（GET/POST/PUT/DELETE）表示操作\n2. 使用名词而非动词命名资源（/users而非/getUsers）\n3. 使用HTTP状态码表示结果\n4. 支持分页、过滤和排序\n5. 版本控制（/api/v1/）\n6. 无状态通信\n7. 使用JSON作为数据格式\n8. 提供清晰的错误信息'
    },
    {
        question: '如何在Linux中查找大文件？',
        answer: '在Linux中查找大文件的几种方法：\n1. find / -type f -size +100M - 查找大于100MB的文件\n2. du -ah / | sort -rh | head -20 - 显示最大的20个文件/目录\n3. ncdu / - 交互式磁盘使用分析工具\n4. ls -lhS /path - 按大小排序列出文件'
    },
    {
        question: '什么是微服务架构？优缺点是什么？',
        answer: '微服务架构将应用拆分为多个小型、独立部署的服务。\n优点：独立部署和扩展、技术栈灵活、故障隔离、团队自治。\n缺点：分布式系统复杂性、网络延迟、数据一致性挑战、运维成本高、调试困难。\n适用于大型复杂应用，小项目建议从单体架构开始。'
    },
    {
        question: '如何处理JavaScript中的异步错误？',
        answer: '处理JavaScript异步错误的方法：\n1. try/catch配合async/await\n2. Promise的.catch()方法\n3. Promise.allSettled()处理多个Promise\n4. 全局错误处理：window.addEventListener("unhandledrejection")\n5. Node.js中：process.on("unhandledRejection")\n\n推荐使用async/await + try/catch，代码最清晰。'
    }
];
