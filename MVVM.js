// 
class Dep {
    constructor() {
        this.subs = []
    }

    // 订阅
    addSub(watcher) {
        this.subs.push(watcher)
    }

    // 发布
    notify() {
        this.subs.forEach(watcher => {
            watcher.update()
        })
    }
}

// vm.$watch(vm, expr, ()=>{})
class Watcher {
    constructor(vm, expr, cb){
        this.vm = vm;
        this.expr = expr;
        this.cb = cb;

        // 默认会获取一个老值
        this.oldValue = this.get()
    }
    get(){
        Dep.target = this;   // 怎么能让Dep获取到这个watch。就是当前实例挂载到Dep的静态属性上
        let value = CompileUtil.getVal(this.vm, this.expr)
        Dep.target = null;  // 用完记得置空。
        return value;
    }
    update(){ 
        let newValue = CompileUtil.getVal(this.vm, this.expr)  // 执行update的时候获取最新的表达式的值
        if(this.oldValue !== newValue) {  // 更新操作。当数据变化的时候执行cb回调函数
            this.cb(newValue)
        }
    }
}

// 实现数据劫持
class Observer {
    constructor(data) {
        for(let key in data) {
            this.observer(data)
        }
    }
    observer(data) {
        // 如果观察者是对象才观察
        if(data && typeof data === 'object') {
            for(let key in data) {
                this.defineReactive(data, key, data[key])
            }
        }
    }
    defineReactive(obj, key, value) { 
        this.observer(value); // 只能对传进来的school第一层做一个拦截。如果还想再拦截子属性。那么就在遍历一次。
        let dep = new Dep(); // 给每个属性都加上一个发布订阅的功能
        Object.defineProperty(obj, key, {
            get() {
                Dep.target && dep.addSub(Dep.target)
                return value
            },
            set: (newValue)=> {
                if(newValue !== value) {
                    this.observer(newValue);  // 比如要给school = {a:1} 这个{a:1}新对象不会被代理。所以要在这里给整个对象在循环代理一下。这里不用箭头函数this指向data。所以需要箭头函数
                    value = newValue;
                    dep.notify();     // 比如school.name在页面中出现了两次。就会有[watcher, watcher]。当数据变化的时候就会调用这两个watcher的update方法比较新旧值来判断是否执行更新函数
                }
            }
        })
    }
}



class Compiler {
    constructor(el, vm) {
        // el有可能是字符串app也有可能是node节点。所以需要判断一下
        this.el = this.isElement(el) ? el : document.querySelector(el);
        this.vm = vm;

        // 创建文档碎片(源码中是用AST来解析的)
        let fragment = this.node2Fragment(this.el)

        // 对内存节点进行模板编译
        this.compile(fragment)

        // 最终将编译好的模板塞到页面中
        this.el.append(fragment)
    }
    node2Fragment(node) {
        let fragment = document.createDocumentFragment();
        let firstChild
        while(firstChild = node.firstChild) {
            // appendChild具有可移动性。所以不会死循环
            fragment.appendChild(firstChild)
        }
        return fragment;
    }
    // 核心的编译方法
    compile(node) {
        node.childNodes.forEach(child => {  // childNodes只会获取第一层节点。比如  <div>123</div>  他只能获取div标签。不能获取div里的123。所以才要执行下面的compile(child)
            if(this.isElement(child)) {  // 如果是dom节点。就执行dom节点的函数。否则就执行文本的函数
                this.compileElement(child)

                // 如果节点中还有内容。那么就把自己传过去。在进行编译子节点
                this.compile(child)
            } else {
                this.compileText(child) // 文本的函数
            }
        })
    }
    isDirective(attrName) { // 判断字符串是不是以v-开头
        return attrName.startsWith('v-');
    }
    // 编译节点
    compileElement(node) {
        let attributes = node.attributes;
        [...attributes].forEach(attr => {
            let {name, value:expr} = attr;  // v-model='school.name' => [name:'v-model',  expr: 'school.name']
            if(this.isDirective(name)) { // v-model  v-html  v-text
                let [, directive] = name.split('-')         
                let [directiveName, eventName] = directive.split(':'); // v-on:click遇到这种指令的还需要进一步分割
                // 调用不同指令
                CompileUtil[directiveName](node, expr, this.vm, eventName)
            }
        })
    }
    // 编译文本 
    compileText(node) {
        let content = node.textContent;
        if(/\{\{(.+?)\}\}/.test(content)) {   // {{aaa}} {{bbb}}
            CompileUtil['text'](node, content, this.vm)
        }
    }
    isElement(el) {  // 判断是否是节点
        return el.nodeType === 1; // nodeType=1是dom节点。 nodeType=3是文本
    }
}

CompileUtil = {
    getVal(vm, expr) {  // vm.$data.school => vm.$data.school.name
        return expr.split('.').reduce((prev, next) => {
            return prev[next]
        }, vm.$data)
    },
    setVal(vm, expr, value) { // 对于重新给v-model=xxx赋值的属性。要根据xxx的长度来判断是否获取完毕。获取完毕之后用input的value值重新赋值给xxx。
        expr.split('.').reduce((prev, next, index, arr) => {
            if(index === arr.length - 1) {
                return prev[next] = value;
            }
            return prev[next]
        }, vm.$data)
    },
    on(node, expr, vm, eventName) {  // v-on:click="change"  vm就是new Vue的实例  expr在这里就是change
        node.addEventListener(eventName, (e) => {
            vm[expr].call(vm, e)
        })
    },
    model(node, expr, vm) {  // expr有可能是school.name这种类型的。直接写vm.$data[expr] 就变成了 vm.$data['school.name']。  这样写的话变成获取字符串了。
        let fn = this.updater['modelUpdater'];
        let value = this.getVal(vm, expr);
        new Watcher(vm, expr, (newValue) => { // 给输入框加一个观察者。当输入框的值发生变化的时候。会拿取新值赋予输入框
            fn(node, newValue);
        })

        node.addEventListener('input', (e) => { // v-model是输入框。给输入框加一个input事件
            let value = e.target.value;
            // fn(node, value) // 这边不应该直接给节点赋值。而是给vm.$data里的数据赋值。
            this.setVal(vm, expr, value)
        })
        fn(node, value);
    },
    html(node, expr, vm) {
        let fn = this.updater['htmlUpdater'];
        let value = this.getVal(vm, expr);
        new Watcher(vm, expr, (newValue) => { // 给输入框加一个观察者。当输入框的值发生变化的时候。会拿取新值赋予输入框
            fn(node, newValue);
        })
        fn(node, value);
    },
    getContentValue(vm, expr) { // 重新获取{{a}} {{b}} {{c}}里完整的三个值给node节点赋值
        return expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
            return this.getVal(vm, args[1])
        })
    },
    text(node, expr, vm) {
        let fn = this.updater['textUpdater'];
        let content = expr.replace(/\{\{(.+?)\}\}/g, (...args) => { // 利用正则过滤掉{{}}。只留下变量
            new Watcher(vm, args[1], () => { // watcher要监听{{a}}括号里的a的值。所以写args[1]。给每个args[1]加上观察者
                fn(node, this.getContentValue(vm, expr))  // {{a}} {{b}}  当我们节点的内容是两个{{}}的时候。每次a变了或者b变了或者a跟b都变了。都需要重新获取整个节点里的值赋值。
            })
            return this.getVal(vm, args[1])
        })
        fn(node, content)
    },
    updater: {
        htmlUpdater(node, value) {
            node.innerHTML = value;
        },
        modelUpdater(node, value){ // 给input的value赋值
            node.value = value;
        },
        textUpdater(node, value){ // 给文本赋值
            node.textContent = value
        }
    }
}

class Vue{
    constructor(options) {
        this.$el = options.el;
        this.$data = options.data;
        let computed = options.computed;
        let methods = options.methods;

        // 如果根节点存在。那么对模板进行编译
        if(this.$el) {
            // 数据劫持
            new Observer(this.$data);
            
            // 把computed代理到$data上。 模板{{getNewname}}   我们getVal的reduce方法里获取的是vm.$data.getNewname    所以在模板编译之前。把computed的值代理到$data上
            // 然后再在下面的 proxyVm 代理到vm商
            for(let key in computed) {
                Object.defineProperty(this.$data, key, {
                    get:()=>{
                        return computed[key].call(this);
                    }
                })
            }

            // 把methods也代理到vm上
            for(let key in methods) {
                Object.defineProperty(this, key, {
                    get() {
                        return methods[key]
                    }
                })
            }

            // 数据代理
            this.proxyVM(this.$data);

            // 模板编译
            new Compiler(this.$el, this);
        }

        
    }
    proxyVM(data) {
        for(let key in data) {
            Object.defineProperty(this, key, { // 可以实现通过vm.xxx获取vm.$data.xxx
                get() {
                    return data[key] // 进行转化操作
                },
                set(newValue) {   // 赋值给this.xxx的代理到this.$data.xxx
                    data[key] = newValue
                }
            })
        }
    }
}